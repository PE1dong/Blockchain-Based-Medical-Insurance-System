// scripts/deploy.js
const { ethers } = require("hardhat");

async function main() {
  // 1) 把五个角色解构出来
  const [deployer, insuranceAuthority, hospital, patient, pharmacy] = await ethers.getSigners();
  console.log("Deploying with deployer:", deployer.address);
  console.log("Insurance authority:", insuranceAuthority.address);

  // 2) 零地址常量（v6）
  const ZERO = ethers.ZeroAddress;

  // —— 部署 FraudDetector （先占位给 registry）
  const FraudFactory = await ethers.getContractFactory("SimpleFraudDetector");
  const fraudDetector = await FraudFactory.deploy(ZERO);
  await fraudDetector.waitForDeployment();
  console.log("  FraudDetector:", fraudDetector.target);

  // —— 部署 MedicalFlowRegistry
  const RegistryFactory = await ethers.getContractFactory("MedicalFlowRegistry");
  const registry = await RegistryFactory.deploy(
    fraudDetector.target,         // _fraudDetector
    insuranceAuthority.address,   // _insuranceAuthority
    ZERO                          // _reimbursementContract（后面会更新）
  );
  await registry.waitForDeployment();
  console.log("  Registry:", registry.target);

  // —— 部署 AutoReimbursement
  const AutoFactory = await ethers.getContractFactory("AutoReimbursement");
  const autoReimbursement = await AutoFactory.deploy(registry.target);
  await autoReimbursement.waitForDeployment();
  console.log("  AutoReimbursement:", autoReimbursement.target);

  // 3) 给 AutoReimbursement 打点 ETH
  await deployer.sendTransaction({
    to: autoReimbursement.target,
    value: ethers.parseEther("10.0"),
  });
  console.log("  Funded AutoReimbursement");

  // 4) 把报销合约地址写回 Registry
  const tx1 = await registry.connect(deployer)
                         .setReimbursementContract(autoReimbursement.target);
  await tx1.wait();
  console.log("  Registry.reimbursementContract set");

  // 5) 把 Registry 地址写回 FraudDetector
  const tx2 = await fraudDetector.connect(deployer)
                                 .setRegistry(registry.target);
  await tx2.wait();
  console.log("  FraudDetector.registry set");

  console.log("✅ All contracts deployed successfully");
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("❌ deployment failed:", err);
    process.exit(1);
  });
