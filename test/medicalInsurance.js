// test/medicalInsurance.test.js
const { expect } = require("chai");
const { ethers } = require("hardhat");
const drugPrices     = require("../oracle/data/drugPrices.json");
const reimbursements = require("../oracle/data/reimbursementRates_byProvince.json");

describe("Medical Insurance System", function () {
  let fraudDetector;
  let autoReimbursement;
  let medicalFlowRegistry;
  let deployer, patient, hospital, pharmacy;

  const HOSPITAL_NAME     = "Beijing General Hospital";
  const PHARMACY_NAME     = "Central Pharmacy";
  const PHARMACY_OPERATOR = "Zhang Wei";
  const PROVINCE          = "Beijing";
  const DISEASE           = "Infectious Diseases";
  const DRUG_NAMES        = ["Amoxycillin", "Ibuprofen"];
  const DRUG_QUANTITIES   = [2, 1];
  const DOCTOR_NAME       = "Dr. Li";
  const TREATMENT_DAYS    = 5;
  const ZERO_ADDRESS      = ethers.ZeroAddress;

  beforeEach(async function () {
    [deployer, patient, hospital, pharmacy] = await ethers.getSigners();

    // 部署 SimpleFraudDetector
    const Fraud = await ethers.getContractFactory("SimpleFraudDetector");
    fraudDetector = await Fraud.deploy(ZERO_ADDRESS);
    await fraudDetector.waitForDeployment();

    // 部署 MedicalFlowRegistry
    const Registry = await ethers.getContractFactory("MedicalFlowRegistry");
    medicalFlowRegistry = await Registry.deploy(
      fraudDetector.target,
      deployer.address,
      ZERO_ADDRESS
    );
    await medicalFlowRegistry.waitForDeployment();

    // 部署 AutoReimbursement
    const Auto = await ethers.getContractFactory("AutoReimbursement");
    autoReimbursement = await Auto.deploy(medicalFlowRegistry.target);
    await autoReimbursement.waitForDeployment();

    // 给 AutoReimbursement 充值
    await deployer.sendTransaction({
      to: autoReimbursement.target,
      value: ethers.parseEther("10.0")
    });

    // 更新 Registry 中的报销合约地址
    await medicalFlowRegistry.connect(deployer)
      .setReimbursementContract(autoReimbursement.target);

    // 设置 FraudDetector 的 registry
    await fraudDetector.connect(deployer)
      .setRegistry(medicalFlowRegistry.target);

    // 加载药品价格
    for (const [name, price] of Object.entries(drugPrices)) {
      await autoReimbursement.setDrugPrice(name, price);
    }
    // 加载各省报销率
    for (const [province, drugs] of Object.entries(reimbursements)) {
      for (const [drug, rate] of Object.entries(drugs)) {
        await autoReimbursement.setReimbursementRate(province, drug, rate);
      }
    }
    // 注册医院
    await medicalFlowRegistry.registerHospital(HOSPITAL_NAME, hospital.address);
  });

  describe("AutoReimbursement", function () {
    it("should set drug prices correctly", async function () {
      const keys = Object.keys(drugPrices);
      if (keys.length < 2) this.skip();
      const [d1, d2] = keys;

      const price1 = await autoReimbursement.drugPrices(d1);
      const price2 = await autoReimbursement.drugPrices(d2);

      expect(Number(price1)).to.equal(Number(drugPrices[d1]));
      expect(Number(price2)).to.equal(Number(drugPrices[d2]));
    });

    it("should set reimbursement rates correctly", async function () {
      if (!reimbursements[PROVINCE]) this.skip();
      const drugs = Object.keys(reimbursements[PROVINCE]);
      if (drugs.length === 0) this.skip();
      const drug = drugs[0];

      const rate = await autoReimbursement.reimbursementRates(PROVINCE, drug);
      expect(Number(rate)).to.equal(Number(reimbursements[PROVINCE][drug]));
    });

    it("should allow updating registry address", async function () {
      const orig = await autoReimbursement.registry();
      await autoReimbursement.setRegistry(orig);
      expect(await autoReimbursement.registry()).to.equal(orig);
    });
  });

  describe("MedicalFlowRegistry", function () {
    it("should create a medical record", async function () {
      // 患者创建记录
      const tx      = await medicalFlowRegistry.connect(patient)
        .createRecord(HOSPITAL_NAME, PROVINCE);
      const receipt = await tx.wait();

      // 从 receipt.logs 里解析事件
      const log = receipt.logs.find(log => {
        try {
          const parsed = medicalFlowRegistry.interface.parseLog(log);
          return parsed.name === "RecordCreated";
        } catch {
          return false;
        }
      });
      expect(log, "找不到 RecordCreated 事件").to.exist;

      const parsed = medicalFlowRegistry.interface.parseLog(log);
      const recordId = parsed.args.recordId;

      const record = await medicalFlowRegistry.records(recordId);
      expect(record.patient).to.equal(patient.address);
      expect(record.province).to.equal(PROVINCE);
      expect(record.hospital).to.equal(HOSPITAL_NAME);
    });
  });

  describe("End-to-End Flow", function () {
    let recordId;
    let prescriptionHash;

    beforeEach(async function () {
      // 患者创建记录
      const tx      = await medicalFlowRegistry.connect(patient)
        .createRecord(HOSPITAL_NAME, PROVINCE);
      const receipt = await tx.wait();

      const log = receipt.logs.find(log => {
        try {
          return medicalFlowRegistry.interface.parseLog(log).name === "RecordCreated";
        } catch {
          return false;
        }
      });
      if (!log) this.skip();
      const parsed = medicalFlowRegistry.interface.parseLog(log);
      recordId = parsed.args.recordId;

      // 构造处方哈希
      prescriptionHash = ethers.keccak256(
        ethers.toUtf8Bytes("Prescription for " + patient.address)
      );
    });

    it("should complete the full medical flow process", async function () {
      // 2. 医院提交
      const hSig = await hospital.signMessage(ethers.getBytes(prescriptionHash));
      const hospitalData = {
        illness:           DISEASE,
        doctorName:        DOCTOR_NAME,
        medicines:         DRUG_NAMES,
        medicineAmounts:   DRUG_QUANTITIES,
        treatmentDays:     TREATMENT_DAYS,
        prescriptionHash,
        hospitalSignature: hSig
      };
      await medicalFlowRegistry.connect(hospital)
        .hospitalSubmit(recordId, hospitalData);

      let rec = await medicalFlowRegistry.records(recordId);
      expect(rec.status).to.equal(1); // HospitalSubmitted

      // 3. 患者确认
      const pSig = await patient.signMessage(ethers.getBytes(prescriptionHash));
      await medicalFlowRegistry.connect(patient)
        .confirmPrescription(recordId, prescriptionHash, pSig);

      rec = await medicalFlowRegistry.records(recordId);
      expect(rec.status).to.equal(2); // PatientConfirmed

      // 4. 药房确认
      await medicalFlowRegistry.connect(pharmacy)
        .pharmacyConfirm(
          recordId,
          PHARMACY_NAME,
          PHARMACY_OPERATOR,
          prescriptionHash
        );

      rec = await medicalFlowRegistry.records(recordId);
      expect(rec.status).to.equal(3);
      expect(rec.pharmacyName).to.equal(PHARMACY_NAME);
      expect(rec.pharmacyOperator).to.equal(PHARMACY_OPERATOR);

      // 5. 保险审批
      const txApprove = await medicalFlowRegistry.connect(deployer)
        .checkFraudAndApprove(recordId);
      await txApprove.wait();

      rec = await medicalFlowRegistry.records(recordId);
      expect(rec.status).to.equal(5);   // Approved
      expect(rec.approved).to.equal(true);
    });
  });
});
