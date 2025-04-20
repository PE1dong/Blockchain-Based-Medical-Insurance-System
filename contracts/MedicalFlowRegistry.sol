// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

interface IFraudDetector {
    function verify(bytes32 recordId) external returns (bool);
}

interface IAutoReimbursement {
    function reimburse(bytes32 recordId) external;
}

contract MedicalFlowRegistry {
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

    mapping(bytes32 => Record) public records;
    mapping(string => address) public hospitalAccounts;
    mapping(bytes32 => bool) public usedPatientHashes;

    address public fraudDetector;
    address public insuranceAuthority;
    address public reimbursementContract;

    event RecordCreated(bytes32 recordId, address patient);
    event HospitalSubmitted(bytes32 recordId);
    event PatientConfirmed(bytes32 recordId);
    event PharmacyConfirmed(bytes32 recordId);
    event RecordApproved(bytes32 recordId);
    event HospitalRegistered(string name, address account);

    modifier onlyInsurance() {
        require(msg.sender == insuranceAuthority, "Only insurance authority allowed");
        _;
    }

    constructor(address _fraudDetector, address _insuranceAuthority, address _reimbursementContract) {
        fraudDetector = _fraudDetector;
        insuranceAuthority = _insuranceAuthority;
        reimbursementContract = _reimbursementContract;
    }

    function registerHospital(string calldata name, address account) external onlyInsurance {
        require(account != address(0), "Invalid hospital address");
        hospitalAccounts[name] = account;
        emit HospitalRegistered(name, account);
    }

    function createRecord(string memory hospital, string memory province) external returns (bytes32) {
        bytes32 recordId = keccak256(abi.encodePacked(msg.sender, block.timestamp));
        
        Record storage newRecord = records[recordId];
        newRecord.patient = msg.sender;
        newRecord.province = province;
        newRecord.hospital = hospital;
        newRecord.status = Status.Created;

        emit RecordCreated(recordId, msg.sender);
        return recordId;
    }

    function hospitalSubmit(
        bytes32 recordId,
        HospitalData calldata data
    ) external {
        Record storage r = records[recordId];
        require(r.status == Status.Created, "Invalid stage");
        require(msg.sender == hospitalAccounts[r.hospital], "Unauthorized hospital address");

        r.hospitalData = data;
        r.status = Status.HospitalSubmitted;
        emit HospitalSubmitted(recordId);
    }

    function confirmPrescription(bytes32 recordId, bytes32 signedHash, bytes memory patientSignature) external {
        Record storage r = records[recordId];
        require(r.status == Status.HospitalSubmitted, "Hospital submission required");
        require(msg.sender == r.patient, "Only patient can confirm");

        require(!usedPatientHashes[signedHash], "Signature already used");
        address recovered = recoverSigner(signedHash, patientSignature);
        require(recovered == r.patient, "Invalid patient signature");

        usedPatientHashes[signedHash] = true;
        r.status = Status.PatientConfirmed;
        emit PatientConfirmed(recordId);
    }

    function pharmacyConfirm(bytes32 recordId, string memory pharmacyName, string memory pharmacyOperator, bytes32 confirmHash) external {
        Record storage r = records[recordId];
        require(r.status == Status.PatientConfirmed, "Patient confirmation required");
        require(confirmHash == r.hospitalData.prescriptionHash, "Prescription mismatch");

        address hospitalSigner = recoverSigner(r.hospitalData.prescriptionHash, r.hospitalData.hospitalSignature);
        require(hospitalSigner == hospitalAccounts[r.hospital], "Invalid hospital signature");

        r.pharmacyConfirmed = true;
        r.pharmacyName = pharmacyName;
        r.pharmacyOperator = pharmacyOperator;
        r.pharmacyConfirmTime = block.timestamp;
        r.status = Status.PharmacyConfirmed;
        emit PharmacyConfirmed(recordId);
    }

    function checkFraudAndApprove(bytes32 recordId) external onlyInsurance {
        Record storage r = records[recordId];
        require(r.status == Status.PharmacyConfirmed, "Pharmacy confirmation required");
        bool passed = IFraudDetector(fraudDetector).verify(recordId);
        require(passed, "Fraud Detected");
        r.approved = true;
        r.status = Status.Approved;
        emit RecordApproved(recordId);
        IAutoReimbursement(reimbursementContract).reimburse(recordId);
    }

    // function recoverSigner(bytes32 message, bytes memory sig) internal pure returns (address) {
    //     require(sig.length == 65, "Invalid signature length");
    //     bytes32 r;
    //     bytes32 s;
    //     uint8 v;
    //     assembly {
    //         r := mload(add(sig, 32))
    //         s := mload(add(sig, 64))
    //         v := byte(0, mload(add(sig, 96)))
    //     }
    //     return ecrecover(message, v, r, s);
    // }

    function recoverSigner(bytes32 message, bytes memory sig) internal pure returns (address) {
    require(sig.length == 65, "Invalid signature length");

    // 添加以太坊签名前缀
    bytes32 ethSignedMessageHash = keccak256(
        abi.encodePacked("\x19Ethereum Signed Message:\n32", message)
    );
    
    bytes32 r;
    bytes32 s;
    uint8 v;
    assembly {
        r := mload(add(sig, 32))
        s := mload(add(sig, 64))
        v := byte(0, mload(add(sig, 96)))
    }
    
    // 如果 v 是 0 或 1，需要加 27
    if (v < 27) {
        v += 27;
    }
    
    require(v == 27 || v == 28, "Invalid signature 'v' value");
    
    return ecrecover(ethSignedMessageHash, v, r, s);
    }

    function setReimbursementContract(address _reimbursementContract) external {
    reimbursementContract = _reimbursementContract;
    }

    function getRecord(bytes32 recordId) external view returns (
    address patient,
    string memory province,
    string[] memory medicines,
    uint256[] memory medicineAmounts
    ) {
    Record storage r = records[recordId];
    return (
        r.patient,
        r.province,
        r.hospitalData.medicines,
        r.hospitalData.medicineAmounts
    );
    }
    /// @notice 返回当前状态枚举值
    function getRecordStatus(bytes32 recordId) external view returns(Status) {
        return records[recordId].status;
    }

    /// @notice 返回审批标志
    function isRecordApproved(bytes32 recordId) external view returns(bool) {
        return records[recordId].approved;
    }

    function getFullRecord(bytes32 recordId)
       external
       view
       returns (Record memory)
    {
       return records[recordId];
    }
}