// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ITribunal } from "./interfaces/ITribunal.sol";

interface IRegistry {
    enum Role { None, Lawyer, Judge }
    function roleOf(address) external view returns (Role);
}

interface IEscrow {
    function flagDisputed(uint256 id) external;
}

interface IVerdictLog {
    function post(uint256 caseId, bool prevailingIsAccuser, bytes32 opinionRoot) external;
    function attachReceipt(uint256 caseId, bytes32 receiptHash, string calldata receiptUrl) external;
}

/// @title TribunalCore
/// @notice Case state machine. Address-keyed parties, payable fileCase with
///         BASE_FEE, role-gated argument and ruling submission.
contract TribunalCore is ITribunal, Ownable {
    IRegistry public immutable registry;
    address public immutable runner; // operator that anchors events; restricted in MVP

    uint256 public constant BASE_FEE = 0.01 ether;
    uint256 public feesAccrued;

    struct Case {
        CaseStatus status;
        address accuser;
        address defendant;
        address escrowAdapter;
        uint256 escrowId;
        address[] judges;
        uint256 threshold;
        uint256 yes;
        uint256 no;
        uint256 nextSeq;
        bool    prevailingIsAccuser;
    }

    uint256 public nextCaseId = 1;
    mapping(uint256 => Case) private cases;
    mapping(uint256 => mapping(address => bool)) public hasRuled;

    constructor(address registry_) Ownable(msg.sender) {
        require(registry_ != address(0), "zero registry");
        registry = IRegistry(registry_);
        runner = msg.sender;
    }

    modifier onlyRunner() { require(msg.sender == runner, "not runner"); _; }

    function fileCase(
        address defendant,
        address escrowAdapter,
        uint256 escrowId,
        string calldata accusationCid
    ) external payable override returns (uint256 id) {
        require(msg.value >= BASE_FEE, "fee");
        feesAccrued += msg.value;

        id = nextCaseId++;
        Case storage c = cases[id];
        c.status = CaseStatus.Filed;
        c.accuser = msg.sender;
        c.defendant = defendant;
        c.escrowAdapter = escrowAdapter;
        c.escrowId = escrowId;
        if (escrowAdapter != address(0)) IEscrow(escrowAdapter).flagDisputed(escrowId);
        emit CaseFiled(id, msg.sender, defendant, escrowAdapter, escrowId, accusationCid, msg.value);
    }

    function acceptCase(uint256 id, address[] calldata judges, uint256 threshold) external onlyOwner {
        Case storage c = cases[id];
        require(c.status == CaseStatus.Filed, "bad state");
        require(judges.length > 0 && threshold > 0 && threshold <= judges.length, "bad panel");
        for (uint256 i = 0; i < judges.length; i++) {
            require(registry.roleOf(judges[i]) == IRegistry.Role.Judge, "not a judge");
        }
        c.judges = judges;
        c.threshold = threshold;
        c.status = CaseStatus.Arguments;
        emit CaseAccepted(id, judges);
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

        bool onPanel = false;
        for (uint256 i = 0; i < c.judges.length; i++) {
            if (c.judges[i] == msg.sender) { onPanel = true; break; }
        }
        require(onPanel, "not a panel judge");
        require(registry.roleOf(msg.sender) == IRegistry.Role.Judge, "not a judge");
        require(!hasRuled[id][msg.sender], "double vote");
        hasRuled[id][msg.sender] = true;

        if (prevailingIsAccuser) c.yes += 1; else c.no += 1;
        emit RulingSubmitted(id, msg.sender, prevailingIsAccuser, opinionHash);

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

    function finalizeVerdict(uint256 id, address verdictLog, bytes32 opinionRoot) external onlyRunner {
        Case storage c = cases[id];
        require(c.status == CaseStatus.Ruled, "not ruled");
        IVerdictLog(verdictLog).post(id, c.prevailingIsAccuser, opinionRoot);
        c.status = CaseStatus.Settled;
    }

    /// Like `finalizeVerdict`, plus attaches a verifiable-inference receipt
    /// (REE) to the VerdictLog in the same tx. Empty `receiptUrl` and zero
    /// `receiptHash` skip the attachment, so callers without a receipt can
    /// still use this single entrypoint.
    function finalizeVerdictWithReceipt(
        uint256 id,
        address verdictLog,
        bytes32 opinionRoot,
        bytes32 receiptHash,
        string calldata receiptUrl
    ) external onlyRunner {
        Case storage c = cases[id];
        require(c.status == CaseStatus.Ruled, "not ruled");
        IVerdictLog(verdictLog).post(id, c.prevailingIsAccuser, opinionRoot);
        if (receiptHash != bytes32(0) && bytes(receiptUrl).length > 0) {
            IVerdictLog(verdictLog).attachReceipt(id, receiptHash, receiptUrl);
        }
        c.status = CaseStatus.Settled;
    }

    function withdrawFees(address payable to) external onlyOwner {
        uint256 amount = feesAccrued;
        feesAccrued = 0;
        (bool ok, ) = to.call{ value: amount }("");
        require(ok, "transfer failed");
    }

    // ---- views ----
    function caseStatus(uint256 id) external view returns (CaseStatus) { return cases[id].status; }
    function caseJudges(uint256 id) external view returns (address[] memory) { return cases[id].judges; }
    function caseThreshold(uint256 id) external view returns (uint256) { return cases[id].threshold; }
    function casePrevailing(uint256 id) external view returns (bool) { return cases[id].prevailingIsAccuser; }
    function caseAccuser(uint256 id) external view returns (address) { return cases[id].accuser; }
    function caseDefendant(uint256 id) external view returns (address) { return cases[id].defendant; }
    function caseEscrow(uint256 id) external view returns (address, uint256) {
        return (cases[id].escrowAdapter, cases[id].escrowId);
    }
    function caseSeq(uint256 id) external view returns (uint256) { return cases[id].nextSeq; }
}
