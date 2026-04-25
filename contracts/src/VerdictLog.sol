// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title VerdictLog
/// @notice Append-only public log of finalized verdicts. Posted by the
///         Tribunal contract; readable by anyone (e.g. KeeperHub triggers).
contract VerdictLog {
    struct Verdict {
        bool exists;
        bool prevailingIsAccuser;
        bytes32 opinionRoot;
        uint64 postedAt;
    }

    address public immutable tribunal;
    mapping(uint256 => Verdict) public verdicts;

    event VerdictPosted(uint256 indexed caseId, bool prevailingIsAccuser, bytes32 opinionRoot);

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
}
