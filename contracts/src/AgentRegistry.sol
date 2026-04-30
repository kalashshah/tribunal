// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @title AgentRegistry
/// @notice Address-keyed role table for Tribunal participants.
///         Litigants are not stored — anyone with a wallet may file as a litigant.
contract AgentRegistry is Ownable {
    enum Role { None, Lawyer, Judge }

    mapping(address => Role) public roleOf;

    event RoleAdmitted(address indexed who, Role role);
    event RoleRevoked(address indexed who, Role previous);

    constructor() Ownable(msg.sender) {}

    function admitJudge(address who) external onlyOwner {
        roleOf[who] = Role.Judge;
        emit RoleAdmitted(who, Role.Judge);
    }

    function admitLawyer(address who) external onlyOwner {
        roleOf[who] = Role.Lawyer;
        emit RoleAdmitted(who, Role.Lawyer);
    }

    function revoke(address who) external onlyOwner {
        Role prev = roleOf[who];
        roleOf[who] = Role.None;
        emit RoleRevoked(who, prev);
    }
}
