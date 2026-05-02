// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title VerdictLog
/// @notice Append-only public log of finalized verdicts. Posted by the
///         Tribunal contract; readable by anyone (e.g. KeeperHub triggers).
///
///         Optional verifiable-inference receipts (REE) are attached
///         out-of-band via `attachReceipt`, so the existing VerdictPosted
///         event signature stays stable for downstream indexers/keepers.
contract VerdictLog {
    struct Verdict {
        bool exists;
        bool prevailingIsAccuser;
        bytes32 opinionRoot;
        uint64 postedAt;
    }

    struct Receipt {
        bool exists;
        bytes32 receiptHash;
        string receiptUrl;
    }

    address public immutable tribunal;
    mapping(uint256 => Verdict) public verdicts;
    mapping(uint256 => Receipt) public receipts;

    event VerdictPosted(uint256 indexed caseId, bool prevailingIsAccuser, bytes32 opinionRoot);
    event VerdictReceiptAttached(uint256 indexed caseId, bytes32 receiptHash, string receiptUrl);

    constructor(address tribunal_) {
        require(tribunal_ != address(0), "zero tribunal");
        tribunal = tribunal_;
    }

    function post(uint256 caseId, bool prevailingIsAccuser, bytes32 opinionRoot) external {
        require(msg.sender == tribunal, "only tribunal");
        require(!verdicts[caseId].exists, "exists");
        verdicts[caseId] = Verdict(true, prevailingIsAccuser, opinionRoot, uint64(block.timestamp));
        emit VerdictPosted(caseId, prevailingIsAccuser, opinionRoot);
    }

    /// Attach a verifiable-inference receipt to an already-posted verdict.
    /// Idempotent — first writer wins; later attempts revert. Anyone can
    /// fetch the receipt blob from `receiptUrl` and re-run it through the
    /// REE verifier to confirm the verdict was produced by the claimed
    /// model on the claimed inputs.
    function attachReceipt(uint256 caseId, bytes32 receiptHash, string calldata receiptUrl) external {
        require(msg.sender == tribunal, "only tribunal");
        require(verdicts[caseId].exists, "no verdict");
        require(!receipts[caseId].exists, "receipt exists");
        receipts[caseId] = Receipt(true, receiptHash, receiptUrl);
        emit VerdictReceiptAttached(caseId, receiptHash, receiptUrl);
    }
}
