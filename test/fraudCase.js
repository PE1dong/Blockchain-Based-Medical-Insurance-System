// test/fraudCase.test.js
// 在 beforeEach 里我们现在会：
// 部署并设置 SimpleFraudDetector、MedicalFlowRegistry、AutoReimbursement（并给它打款），
// 在 Registry 里调用 setReimbursementContract，
// 注册医院，
// 进行第一次完整流程并记录首日用药时间，
// 然后在测试用例里快进小于疗程的天数，第二次用药流程走到“药房确认”后，
// 调用 checkFraudAndApprove 时会因为“重交叉用药”而 revert("Fraud Detected")，并在控制台打印出具体的 elapsedDays。
//说明患者在距离上一次药房确认用药仅 2 天时，就再次到药房取药，而智能合约里规定的最短取药间隔是 5 天。换句话说，他在同一疗程周期内重复取药、重复报销，提前冲抵了未用完的药量。
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Medical Insurance System — Fraud Scenario", function () {
  let registry, fraudDetector, autoReimbursement;
  let deployer, patient, hospital, pharmacy;

  const HOSPITAL_NAME   = "Beijing General Hospital";
  const PHARMACY_NAME   = "Central Pharmacy";
  const PHARMACY_OP     = "Zhang Wei";
  const PROVINCE        = "Beijing";
  const DISEASE         = "Infectious Diseases";
  const MEDICINES       = ["Amoxycillin", "Ibuprofen"];
  const MED_AMOUNTS     = [2, 1];
  const TREATMENT_DAYS  = 5;

  let firstPharmacyTime;

  beforeEach(async function () {
    [deployer, patient, hospital, pharmacy] = await ethers.getSigners();

    // 1. 部署 SimpleFraudDetector（先占位 registry）
    const Fraud = await ethers.getContractFactory("SimpleFraudDetector");
    fraudDetector = await Fraud.deploy(ethers.ZeroAddress);
    await fraudDetector.waitForDeployment();

    // 2. 部署 MedicalFlowRegistry
    const Registry = await ethers.getContractFactory("MedicalFlowRegistry");
    registry = await Registry.deploy(
      fraudDetector.target,
      deployer.address,
      ethers.ZeroAddress  // 占位 reimbursementContract
    );
    await registry.waitForDeployment();
    // 回写 Registry 到 FraudDetector
    await fraudDetector.connect(deployer).setRegistry(registry.target);

    // 3. 部署 AutoReimbursement 并打款
    const Auto = await ethers.getContractFactory("AutoReimbursement");
    autoReimbursement = await Auto.deploy(registry.target);
    await autoReimbursement.waitForDeployment();
    // 给报销合约充值
    await deployer.sendTransaction({
      to: autoReimbursement.target,
      value: ethers.parseEther("10.0")
    });
    // 更新 Registry 的报销合约地址
    await registry.connect(deployer)
      .setReimbursementContract(autoReimbursement.target);

    // 4. 注册医院
    await registry.connect(deployer)
      .registerHospital(HOSPITAL_NAME, hospital.address);

    // ===== 第一次完整流程，记录 firstPharmacyTime =====
    const prescriptionHash1 = ethers.keccak256(
      ethers.toUtf8Bytes("Prescription#1 for " + patient.address)
    );
    // 医院签名
    const hospSig1 = await hospital.signMessage(
      ethers.getBytes(prescriptionHash1)
    );

    // 医院数据
    const hospitalData1 = {
      illness:           DISEASE,
      doctorName:        "Dr. Li",
      medicines:         MEDICINES,
      medicineAmounts:   MED_AMOUNTS,
      treatmentDays:     TREATMENT_DAYS,
      prescriptionHash:  prescriptionHash1,
      hospitalSignature: hospSig1
    };

    // a) patient 创建记录
    const tx1 = await registry.connect(patient)
      .createRecord(HOSPITAL_NAME, PROVINCE);
    const rcpt1 = await tx1.wait();
    const rec1Id = rcpt1.logs
      .map(l => {
        try { return registry.interface.parseLog(l); }
        catch { return null; }
      })
      .find(e => e && e.name === "RecordCreated").args.recordId;

    // b) 医院提交
    await registry.connect(hospital)
      .hospitalSubmit(rec1Id, hospitalData1);

    // c) 患者确认
    const patSig1 = await patient.signMessage(
      ethers.getBytes(prescriptionHash1)
    );
    await registry.connect(patient)
      .confirmPrescription(rec1Id, prescriptionHash1, patSig1);

    // d) 药房确认，记录 timestamp
    const txPh1 = await registry.connect(pharmacy)
      .pharmacyConfirm(
        rec1Id,
        PHARMACY_NAME,
        PHARMACY_OP,
        prescriptionHash1
      );
    const rcptPh1 = await txPh1.wait();
    firstPharmacyTime = (await ethers.provider.getBlock(rcptPh1.blockNumber))
      .timestamp;

    // e) 首次审批，写入历史
    await registry.connect(deployer)
      .checkFraudAndApprove(rec1Id);
  });

  it("should detect fraud when re‑treatment within treatmentDays and print details", async function () {
    // 快进 2 天 (< TREATMENT_DAYS)
    await ethers.provider.send("evm_increaseTime", [2 * 24 * 3600]);
    await ethers.provider.send("evm_mine");

    // 计算并打印间隔
    const nowTs   = (await ethers.provider.getBlock("latest")).timestamp;
    const elapsed = (nowTs - firstPharmacyTime) / 86400;
    console.log(
      `\n🚨 Fraud Check Detail: elapsedDays = ${elapsed.toFixed(2)}, ` +
      `allowed = ${TREATMENT_DAYS}\n`
    );

    // ===== 第二次流程 =====
    const prescriptionHash2 = ethers.keccak256(
      ethers.toUtf8Bytes("Prescription#2 for " + patient.address)
    );
    const hospSig2 = await hospital.signMessage(
      ethers.getBytes(prescriptionHash2)
    );
    const hospitalData2 = {
      illness:           DISEASE,
      doctorName:        "Dr. Li",
      medicines:         MEDICINES,
      medicineAmounts:   MED_AMOUNTS,
      treatmentDays:     TREATMENT_DAYS,
      prescriptionHash:  prescriptionHash2,
      hospitalSignature: hospSig2
    };

    // a) patient 创建第二条记录
    const tx2 = await registry.connect(patient)
      .createRecord(HOSPITAL_NAME, PROVINCE);
    const rcpt2 = await tx2.wait();
    const rec2Id = rcpt2.logs
      .map(l => {
        try { return registry.interface.parseLog(l); }
        catch { return null; }
      })
      .find(e => e && e.name === "RecordCreated").args.recordId;

    // b) 医院提交
    await registry.connect(hospital)
      .hospitalSubmit(rec2Id, hospitalData2);

    // c) 患者确认
    const patSig2 = await patient.signMessage(
      ethers.getBytes(prescriptionHash2)
    );
    await registry.connect(patient)
      .confirmPrescription(rec2Id, prescriptionHash2, patSig2);

    // d) 药房确认
    await registry.connect(pharmacy)
      .pharmacyConfirm(
        rec2Id,
        PHARMACY_NAME,
        PHARMACY_OP,
        prescriptionHash2
      );

    // e) 应因重交叉用药而 revert
    await expect(
      registry.connect(deployer).checkFraudAndApprove(rec2Id)
    ).to.be.revertedWith("Fraud Detected");
  });
});



