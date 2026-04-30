// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

interface ITribunal {
    enum CaseStatus { None, Filed, Accepted, Arguments, Deliberation, Ruled, Settled }

    event CaseFiled(
        uint256 indexed caseId,
        address indexed accuser,
        address indexed defendant,
        address escrowAdapter,
        uint256 escrowId,
        string  accusationCid,
        uint256 fee
    );
    event CaseAccepted(uint256 indexed caseId, address[] judges);
    event CaseEvent(uint256 indexed caseId, uint256 indexed seq, address indexed sender, bytes32 contentHash);
    event RulingSubmitted(uint256 indexed caseId, address indexed judge, bool prevailingIsAccuser, bytes32 opinionHash);
    event CaseRuled(uint256 indexed caseId, bool prevailingIsAccuser);

    function fileCase(
        address defendant,
        address escrowAdapter,
        uint256 escrowId,
        string calldata accusationCid
    ) external payable returns (uint256 caseId);
}
