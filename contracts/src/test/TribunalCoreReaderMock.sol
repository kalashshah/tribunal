// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// Minimal mock implementing the ITribunalCoreReader surface used by
/// TribunalEscrow. Exposes setters so tests can drive the verdict view.
contract TribunalCoreReaderMock {
    mapping(uint256 => uint8)   public caseStatus;
    mapping(uint256 => bool)    public casePrevailing;
    mapping(uint256 => address) public caseAccuser;

    function setCase(uint256 caseId, uint8 status, bool prevailing, address accuser) external {
        caseStatus[caseId] = status;
        casePrevailing[caseId] = prevailing;
        caseAccuser[caseId] = accuser;
    }
}
