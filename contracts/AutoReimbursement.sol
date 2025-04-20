// SPDX-License-Identifier: MIT
pragma solidity ^0.8.7;

interface IMedicalFlowRegistry {
    function getRecord(bytes32 recordId) external view returns (
        address patient,
        string memory province,
        string[] memory medicines,
        uint256[] memory medicineAmounts
    );
}

contract AutoReimbursement {
    address public owner;
    IMedicalFlowRegistry public registry;

    mapping(string => uint256) public drugPrices; // e.g., "Ibuprofen" => 50
    mapping(string => mapping(string => uint256)) public reimbursementRates; // e.g., "Beijing" => "Ibuprofen" => 20 (%)

    event PaymentSent(bytes32 recordId, address patient, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not authorized");
        _;
    }

    constructor(address _registry) {
        owner = msg.sender;
        registry = IMedicalFlowRegistry(_registry);
    }

    function setDrugPrice(string memory drug, uint256 price) external onlyOwner {
        drugPrices[drug] = price;
    }

    function setReimbursementRate(string memory province, string memory drug, uint256 rate) external onlyOwner {
        reimbursementRates[province][drug] = rate;
    }

    function reimburse(bytes32 recordId) external {
        (
            address patient,
            string memory province,
            string[] memory medicines,
            uint256[] memory quantities
        ) = registry.getRecord(recordId);

        require(medicines.length == quantities.length, "Mismatched lengths");

        uint256 total = 0;
        for (uint256 i = 0; i < medicines.length; i++) {
            uint256 price = drugPrices[medicines[i]];
            uint256 rate = reimbursementRates[province][medicines[i]];
            uint256 reimbursed = (price * quantities[i] * rate) / 100;
            total += reimbursed;
        }

        require(address(this).balance >= total, "Insufficient contract balance");
        payable(patient).transfer(total);

        emit PaymentSent(recordId, patient, total);
    }

    function setRegistry(address _registry) external onlyOwner {
        registry = IMedicalFlowRegistry(_registry);
    }

    receive() external payable {}
}
