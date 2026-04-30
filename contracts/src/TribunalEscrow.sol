// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ITribunalCoreReader {
    function caseStatus(uint256 id) external view returns (uint8);
    function casePrevailing(uint256 id) external view returns (bool);
    function caseAccuser(uint256 id) external view returns (address);
}

/// @title TribunalEscrow
/// @notice Native-OG escrow whose payout is decided by a Tribunal verdict on
///         dispute. Implements the IEscrow.flagDisputed callback so it can be
///         passed as the escrowAdapter argument to TribunalCore.fileCase.
contract TribunalEscrow is ReentrancyGuard {
    /// Mirrors TribunalCore.CaseStatus enum index for Settled (used by view check).
    uint8 internal constant TRIBUNAL_STATUS_SETTLED = 6;

    /// 24-hour grace window between payee.claim and finalizeClaim.
    uint256 public constant CLAIM_GRACE = 24 hours;

    enum Status { Draft, Funded, Claimed, Released, Disputed, Settled }

    struct Agreement {
        address payer;
        address payee;
        uint256 amount;       // native OG, in wei
        uint64  deadline;     // unix timestamp; payee may claim after this
        uint64  claimedAt;    // set when payee calls claimAfterDeadline
        Status  status;
        string  termsCid;     // free-form description (data URI, IPFS CID, etc.)
    }

    ITribunalCoreReader public immutable tribunalCore;
    uint256 public nextId = 1;
    mapping(uint256 => Agreement) public agreements;

    event AgreementCreated(uint256 indexed id, address indexed payer, address indexed payee, uint256 amount, uint64 deadline, string termsCid);
    event AgreementFunded(uint256 indexed id, address indexed payer, uint256 amount);
    event AgreementReleased(uint256 indexed id, address indexed payee, uint256 amount, string reason);
    event AgreementClaimed(uint256 indexed id, address indexed payee, uint64 claimedAt);
    event AgreementDisputed(uint256 indexed id);
    event AgreementSettled(uint256 indexed id, uint256 indexed caseId, address indexed recipient, uint256 amount, bool prevailing);

    constructor(address tribunalCore_) {
        require(tribunalCore_ != address(0), "zero tribunal");
        tribunalCore = ITribunalCoreReader(tribunalCore_);
    }

    /// Anyone can create. Payer is the side that owes money; payee receives.
    /// Funds are NOT locked until fundAgreement is called by the payer.
    function createAgreement(
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
        id = nextId++;
        agreements[id] = Agreement({
            payer: payer,
            payee: payee,
            amount: amount,
            deadline: deadline,
            claimedAt: 0,
            status: Status.Draft,
            termsCid: termsCid
        });
        emit AgreementCreated(id, payer, payee, amount, deadline, termsCid);
    }

    /// Payer locks the agreement amount. Must send exactly `amount`.
    function fundAgreement(uint256 id) external payable {
        Agreement storage a = agreements[id];
        require(a.status == Status.Draft, "bad state");
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

    /// Anyone can settle once the linked Tribunal case is Settled. Reads the
    /// verdict + accuser from TribunalCore to determine payout.
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

    /// Convenience view bundling state for off-chain UIs.
    function getAgreement(uint256 id) external view returns (
        address payer, address payee, uint256 amount,
        uint64 deadline, uint64 claimedAt, Status status, string memory termsCid
    ) {
        Agreement storage a = agreements[id];
        return (a.payer, a.payee, a.amount, a.deadline, a.claimedAt, a.status, a.termsCid);
    }

    function _pay(address to, uint256 amount) internal {
        (bool ok, ) = payable(to).call{ value: amount }("");
        require(ok, "transfer failed");
    }
}
