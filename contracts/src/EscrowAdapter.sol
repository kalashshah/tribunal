// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title EscrowAdapter
/// @notice Generic escrow holder. The Tribunal contract is the only address
///         that can flag a disputed escrow or release funds after a verdict.
contract EscrowAdapter {
    using SafeERC20 for IERC20;

    enum Status { None, Open, Disputed, Released }

    struct Escrow {
        address depositor;
        address counterparty;
        IERC20  token;
        uint256 amount;
        Status  status;
    }

    address public immutable tribunal;
    uint256 public nextId = 1;
    mapping(uint256 => Escrow) public escrows;

    event EscrowOpened(uint256 indexed id, address indexed depositor, address indexed counterparty, address token, uint256 amount);
    event EscrowDisputed(uint256 indexed id);
    event EscrowReleased(uint256 indexed id, address indexed to);

    constructor(address tribunal_) {
        require(tribunal_ != address(0), "zero tribunal");
        tribunal = tribunal_;
    }

    function open(address counterparty, address token, uint256 amount) external returns (uint256 id) {
        require(amount > 0, "zero amount");
        require(counterparty != address(0), "zero counterparty");
        id = nextId++;
        escrows[id] = Escrow(msg.sender, counterparty, IERC20(token), amount, Status.Open);
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit EscrowOpened(id, msg.sender, counterparty, token, amount);
    }

    function flagDisputed(uint256 id) external {
        require(msg.sender == tribunal, "only tribunal");
        Escrow storage e = escrows[id];
        require(e.status == Status.Open, "bad state");
        e.status = Status.Disputed;
        emit EscrowDisputed(id);
    }

    function release(uint256 id, address to) external {
        require(msg.sender == tribunal, "only tribunal");
        Escrow storage e = escrows[id];
        require(e.status == Status.Open || e.status == Status.Disputed, "bad state");
        require(to == e.depositor || to == e.counterparty, "bad recipient");
        e.status = Status.Released;
        e.token.safeTransfer(to, e.amount);
        emit EscrowReleased(id, to);
    }
}
