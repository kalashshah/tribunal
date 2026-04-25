// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

interface ITribunal {
    enum CaseStatus { None, Filed, Accepted, Arguments, Deliberation, Ruled, Settled }

    event CaseFiled(
        uint256 indexed caseId,
        uint256 indexed accuserAgentId,
        uint256 indexed defendantAgentId,
        address escrowAdapter,
        uint256 escrowId,
        string  accusationCid
    );
    event CaseAccepted(uint256 indexed caseId, uint256[] judgeAgentIds);
    event CaseEvent(uint256 indexed caseId, uint256 indexed seq, address indexed sender, bytes32 contentHash);
    event RulingSubmitted(uint256 indexed caseId, uint256 indexed judgeAgentId, bool prevailingIsAccuser, bytes32 opinionHash);
    event CaseRuled(uint256 indexed caseId, bool prevailingIsAccuser);

    function fileCase(
        uint256 accuserAgentId,
        uint256 defendantAgentId,
        address escrowAdapter,
        uint256 escrowId,
        string calldata accusationCid
    ) external returns (uint256 caseId);
}
