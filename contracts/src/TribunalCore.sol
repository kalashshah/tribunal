// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { ITribunal } from "./interfaces/ITribunal.sol";

interface IRegistry {
    function agents(uint256) external view returns (address owner, string memory ens, string memory role, bool active);
}

interface IEscrow {
    function flagDisputed(uint256 id) external;
}

interface IVerdictLog {
    function post(uint256 caseId, bool prevailingIsAccuser, bytes32 opinionRoot) external;
}

/// @title TribunalCore
/// @notice Case state machine for AI-agent dispute resolution. Holds anchor
///         hashes of every event in a case and tallies multi-judge rulings.
contract TribunalCore is ITribunal {
    IRegistry public immutable registry;
    address public immutable runner; // operator that anchors events; restricted in MVP

    struct Case {
        CaseStatus status;
        uint256 accuserId;
        uint256 defendantId;
        address escrowAdapter;
        uint256 escrowId;
        uint256[] judges;
        uint256 threshold;
        uint256 yes; // votes for accuser-prevailing
        uint256 no;
        uint256 nextSeq;
        bool    prevailingIsAccuser;
    }

    uint256 public nextCaseId = 1;
    mapping(uint256 => Case) private cases;
    mapping(uint256 => mapping(uint256 => bool)) public hasRuled; // caseId => agentId => bool

    constructor(address registry_) {
        require(registry_ != address(0), "zero registry");
        registry = IRegistry(registry_);
        runner = msg.sender;
    }

    modifier onlyRunner() { require(msg.sender == runner, "not runner"); _; }

    function fileCase(
        uint256 accuserAgentId,
        uint256 defendantAgentId,
        address escrowAdapter,
        uint256 escrowId,
        string calldata accusationCid
    ) external override returns (uint256 id) {
        (address aOwner,,,) = registry.agents(accuserAgentId);
        require(aOwner == msg.sender, "not accuser");

        id = nextCaseId++;
        Case storage c = cases[id];
        c.status = CaseStatus.Filed;
        c.accuserId = accuserAgentId;
        c.defendantId = defendantAgentId;
        c.escrowAdapter = escrowAdapter;
        c.escrowId = escrowId;
        if (escrowAdapter != address(0)) IEscrow(escrowAdapter).flagDisputed(escrowId);
        emit CaseFiled(id, accuserAgentId, defendantAgentId, escrowAdapter, escrowId, accusationCid);
    }

    function acceptCase(uint256 id, uint256[] calldata judgeIds, uint256 threshold) external onlyRunner {
        Case storage c = cases[id];
        require(c.status == CaseStatus.Filed, "bad state");
        require(judgeIds.length > 0 && threshold > 0 && threshold <= judgeIds.length, "bad panel");
        c.judges = judgeIds;
        c.threshold = threshold;
        c.status = CaseStatus.Arguments;
        emit CaseAccepted(id, judgeIds);
    }

    function recordEvent(uint256 id, bytes32 contentHash) external onlyRunner {
        Case storage c = cases[id];
        require(uint8(c.status) >= uint8(CaseStatus.Filed) && c.status != CaseStatus.Settled, "bad state");
        c.nextSeq += 1;
        emit CaseEvent(id, c.nextSeq, msg.sender, contentHash);
    }

    function submitRuling(uint256 id, bool prevailingIsAccuser, bytes32 opinionHash) external {
        Case storage c = cases[id];
        require(c.status == CaseStatus.Arguments || c.status == CaseStatus.Deliberation, "bad state");

        uint256 judgeId = 0;
        for (uint256 i = 0; i < c.judges.length; i++) {
            (address jOwner,,,) = registry.agents(c.judges[i]);
            if (jOwner == msg.sender) { judgeId = c.judges[i]; break; }
        }
        require(judgeId != 0, "not a judge for this case");
        require(!hasRuled[id][judgeId], "double vote");
        hasRuled[id][judgeId] = true;

        if (prevailingIsAccuser) c.yes += 1; else c.no += 1;
        emit RulingSubmitted(id, judgeId, prevailingIsAccuser, opinionHash);

        if (c.yes >= c.threshold || c.no >= c.threshold) {
            c.status = CaseStatus.Ruled;
            c.prevailingIsAccuser = c.yes >= c.threshold;
            emit CaseRuled(id, c.prevailingIsAccuser);
        }
    }

    function markSettled(uint256 id) external onlyRunner {
        Case storage c = cases[id];
        require(c.status == CaseStatus.Ruled, "not ruled");
        c.status = CaseStatus.Settled;
    }

    /// Convenience: post the verdict to VerdictLog and mark the case
    /// settled in one tx. Lets the runner finalise without VerdictLog
    /// trusting the runner directly.
    function finalizeVerdict(uint256 id, address verdictLog, bytes32 opinionRoot) external onlyRunner {
        Case storage c = cases[id];
        require(c.status == CaseStatus.Ruled, "not ruled");
        IVerdictLog(verdictLog).post(id, c.prevailingIsAccuser, opinionRoot);
        c.status = CaseStatus.Settled;
    }

    // ---- views ----
    function caseStatus(uint256 id) external view returns (CaseStatus) { return cases[id].status; }
    function caseJudges(uint256 id) external view returns (uint256[] memory) { return cases[id].judges; }
    function caseThreshold(uint256 id) external view returns (uint256) { return cases[id].threshold; }
    function casePrevailing(uint256 id) external view returns (bool) { return cases[id].prevailingIsAccuser; }
    function caseAccuser(uint256 id) external view returns (uint256) { return cases[id].accuserId; }
    function caseDefendant(uint256 id) external view returns (uint256) { return cases[id].defendantId; }
    function caseEscrow(uint256 id) external view returns (address, uint256) {
        return (cases[id].escrowAdapter, cases[id].escrowId);
    }
    function caseSeq(uint256 id) external view returns (uint256) { return cases[id].nextSeq; }
}
