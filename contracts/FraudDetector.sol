// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "./MedicalFlowRegistry.sol";

interface IMedicalFlowRegistry {
    enum Status { Created, HospitalSubmitted, PatientConfirmed, PharmacyConfirmed, FraudChecked, Approved }

    struct HospitalData {
        string illness;
        string doctorName;
        string[] medicines;
        uint256[] medicineAmounts;
        uint256 treatmentDays;
        bytes32 prescriptionHash;
        bytes hospitalSignature;
    }
    
    struct Record {
        address patient;
        string province;
        string hospital;
        HospitalData hospitalData;
        bool pharmacyConfirmed;
        string pharmacyName;
        string pharmacyOperator;
        uint256 pharmacyConfirmTime;
        bool approved;
        Status status;
    }

    function records(bytes32 recordId) external view returns (Record memory);
}

contract SimpleFraudDetector is IFraudDetector{
    MedicalFlowRegistry public registry;

    // 记录每位患者每种病的最后一次药房出药时间和疗程
    struct IllnessHistory {
        uint256 lastPharmacyTime;
        uint256 lastTreatmentDays;
    }

    // patient => illness => last record
    mapping(address => mapping(string => IllnessHistory)) public illnessHistories;

    constructor(address registryAddress) {
        registry = MedicalFlowRegistry(registryAddress);
    }

    function verify(bytes32 recordId) external override returns (bool) {
        //MedicalFlowRegistry.Record memory r = registry.records(recordId);
        MedicalFlowRegistry.Record memory r = registry.getFullRecord(recordId);
        require(r.pharmacyConfirmed, "Pharmacy not confirmed");

        // 注意：illness 现在在 hospitalData 结构体内
        IllnessHistory memory history = illnessHistories[r.patient][r.hospitalData.illness];

        // 检测是否存在交叉诊疗期
        if (history.lastPharmacyTime != 0) {
            uint256 timeSinceLast = r.pharmacyConfirmTime - history.lastPharmacyTime;
            if (timeSinceLast < history.lastTreatmentDays * 1 days) {
                return false;
            }
        }

        // 更新最新记录
        illnessHistories[r.patient][r.hospitalData.illness] = IllnessHistory({
            lastPharmacyTime: r.pharmacyConfirmTime,
            lastTreatmentDays: r.hospitalData.treatmentDays // 注意：treatmentDays 也在 hospitalData 内
        });

        return true;
    }

    function setRegistry(address newRegistry) external {
        registry = MedicalFlowRegistry(newRegistry);
    }
}