// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ITribunalCoreReader {
    function caseStatus(uint256 id) external view returns (uint8);
    function casePrevailing(uint256 id) external view returns (bool);
    function caseAccuser(uint256 id) external view returns (address);
}

/// @title TribunalEscrow
/// @notice Native-OG escrow with two-step mutual assent: one party proposes,
///         the other accepts, then the payer funds. Disputes go to Tribunal,
///         which writes back via the IEscrow.flagDisputed callback. After the
///         linked case settles, settleByTribunal pays the winner.
contract TribunalEscrow is ReentrancyGuard {
    uint8 internal constant TRIBUNAL_STATUS_SETTLED = 6;
    uint256 public constant CLAIM_GRACE = 24 hours;

    enum Status { Proposed, Accepted, Funded, Claimed, Released, Disputed, Settled, Revoked }

    struct Agreement {
        address payer;
        address payee;
        address proposer;     // payer or payee — whoever called proposeAgreement
        uint256 amount;
        uint64  deadline;
        uint64  claimedAt;
        Status  status;
        string  termsCid;
    }

    ITribunalCoreReader public immutable tribunalCore;
    uint256 public nextId = 1;
    mapping(uint256 => Agreement) public agreements;

    event AgreementProposed(uint256 indexed id, address indexed proposer, address indexed payer, address payee, uint256 amount, uint64 deadline, string termsCid);
    event AgreementAccepted(uint256 indexed id, address indexed acceptedBy);
    event AgreementRevoked(uint256 indexed id);
    event AgreementFunded(uint256 indexed id, address indexed payer, uint256 amount);
    event AgreementReleased(uint256 indexed id, address indexed payee, uint256 amount, string reason);
    event AgreementClaimed(uint256 indexed id, address indexed payee, uint64 claimedAt);
    event AgreementDisputed(uint256 indexed id);
    event AgreementSettled(uint256 indexed id, uint256 indexed caseId, address indexed recipient, uint256 amount, bool prevailing);

    constructor(address tribunalCore_) {
        require(tribunalCore_ != address(0), "zero tribunal");
        tribunalCore = ITribunalCoreReader(tribunalCore_);
    }

    /// One of the parties (payer or payee) drafts the agreement. The other
    /// party must call acceptAgreement before funding is possible.
    function proposeAgreement(
        address payer,
        address payee,
        uint256 amount,
        uint64  deadline,
        string calldata termsCid
    ) external returns (uint256 id) {
        require(payer != address(0) && payee != address(0), "zero party");
        require(payer != payee, "same party");
        require(amount > 0, "zero amount");
        require(deadline > block.timestamp, "past deadline");
        require(msg.sender == payer || msg.sender == payee, "proposer must be a party");
        id = nextId++;
        agreements[id] = Agreement({
            payer: payer,
            payee: payee,
            proposer: msg.sender,
            amount: amount,
            deadline: deadline,
            claimedAt: 0,
            status: Status.Proposed,
            termsCid: termsCid
        });
        emit AgreementProposed(id, msg.sender, payer, payee, amount, deadline, termsCid);
    }

    /// The OTHER party (payer or payee, whichever didn't propose) accepts
    /// the proposal verbatim. After this, the payer can fund.
    function acceptAgreement(uint256 id) external {
        Agreement storage a = agreements[id];
        require(a.status == Status.Proposed, "bad state");
        require(msg.sender == a.payer || msg.sender == a.payee, "only party");
        require(msg.sender != a.proposer, "proposer cannot accept");
        a.status = Status.Accepted;
        emit AgreementAccepted(id, msg.sender);
    }

    /// Proposer can revoke their own proposal before it's accepted. No funds
    /// at stake, so no payout — just terminal cleanup.
    function revokeProposal(uint256 id) external {
        Agreement storage a = agreements[id];
        require(a.status == Status.Proposed, "bad state");
        require(msg.sender == a.proposer, "only proposer");
        a.status = Status.Revoked;
        emit AgreementRevoked(id);
    }

    /// Payer locks the agreement amount. Must send exactly `amount`. Requires
    /// the proposal to have been accepted by the other party.
    function fundAgreement(uint256 id) external payable {
        Agreement storage a = agreements[id];
        require(a.status == Status.Accepted, "bad state");
        require(msg.sender == a.payer, "only payer");
        require(msg.value == a.amount, "wrong value");
        a.status = Status.Funded;
        emit AgreementFunded(id, msg.sender, msg.value);
    }

    /// Payer's happy-path release. Pays the payee in full.
    function releasePayment(uint256 id) external nonReentrant {
        Agreement storage a = agreements[id];
        require(a.status == Status.Funded, "bad state");
        require(msg.sender == a.payer, "only payer");
        a.status = Status.Released;
        _pay(a.payee, a.amount);
        emit AgreementReleased(id, a.payee, a.amount, "payer-released");
    }

    /// Payee asserts work is complete and claims. Starts the 24h dispute window.
    function claimAfterDeadline(uint256 id) external {
        Agreement storage a = agreements[id];
        require(a.status == Status.Funded, "bad state");
        require(msg.sender == a.payee, "only payee");
        require(block.timestamp >= a.deadline, "before deadline");
        a.status = Status.Claimed;
        a.claimedAt = uint64(block.timestamp);
        emit AgreementClaimed(id, msg.sender, a.claimedAt);
    }

    /// Anyone can finalize after the grace window, provided no dispute landed.
    function finalizeClaim(uint256 id) external nonReentrant {
        Agreement storage a = agreements[id];
        require(a.status == Status.Claimed, "bad state");
        require(block.timestamp >= a.claimedAt + CLAIM_GRACE, "in grace");
        a.status = Status.Released;
        _pay(a.payee, a.amount);
        emit AgreementReleased(id, a.payee, a.amount, "grace-elapsed");
    }

    /// Callback from TribunalCore.fileCase when this contract is passed as the
    /// escrowAdapter. Locks the agreement against release/claim until verdict.
    function flagDisputed(uint256 id) external {
        require(msg.sender == address(tribunalCore), "only tribunal");
        Agreement storage a = agreements[id];
        require(a.status == Status.Funded || a.status == Status.Claimed, "bad state");
        a.status = Status.Disputed;
        emit AgreementDisputed(id);
    }

    /// Anyone can settle once the linked Tribunal case is Settled.
    function settleByTribunal(uint256 agreementId, uint256 caseId) external nonReentrant {
        Agreement storage a = agreements[agreementId];
        require(a.status == Status.Disputed, "not disputed");
        require(tribunalCore.caseStatus(caseId) == TRIBUNAL_STATUS_SETTLED, "case not settled");
        address accuser = tribunalCore.caseAccuser(caseId);
        require(accuser == a.payer || accuser == a.payee, "accuser not party");
        bool accuserIsPayee = (accuser == a.payee);
        bool prevailing = tribunalCore.casePrevailing(caseId);
        bool payToPayee = (accuserIsPayee && prevailing) || (!accuserIsPayee && !prevailing);
        address recipient = payToPayee ? a.payee : a.payer;
        a.status = Status.Settled;
        _pay(recipient, a.amount);
        emit AgreementSettled(agreementId, caseId, recipient, a.amount, prevailing);
    }

    /// Convenience view bundling state for off-chain UIs. Tuple now includes proposer.
    function getAgreement(uint256 id) external view returns (
        address payer, address payee, address proposer, uint256 amount,
        uint64 deadline, uint64 claimedAt, Status status, string memory termsCid
    ) {
        Agreement storage a = agreements[id];
        return (a.payer, a.payee, a.proposer, a.amount, a.deadline, a.claimedAt, a.status, a.termsCid);
    }

    function _pay(address to, uint256 amount) internal {
        (bool ok, ) = payable(to).call{ value: amount }("");
        require(ok, "transfer failed");
    }
}
