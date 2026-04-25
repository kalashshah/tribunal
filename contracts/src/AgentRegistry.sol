// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title AgentRegistry
/// @notice Minimal ERC-8004-style registry of agents. Each agent has an
///         owning address, an ENS name, and a role.
contract AgentRegistry {
    struct Agent {
        address owner;
        string  ensName;
        string  role;       // "judge" | "lawyer" | "litigant" | "clerk"
        bool    active;
    }

    uint256 public nextId = 1;
    mapping(uint256 => Agent) public agents;
    mapping(string  => uint256) public idByEns;

    event AgentRegistered(uint256 indexed id, address indexed owner, string ensName, string role);
    event AgentDeactivated(uint256 indexed id);

    function register(string calldata ensName, string calldata role) external returns (uint256 id) {
        require(bytes(ensName).length > 0, "empty ens");
        require(idByEns[ensName] == 0, "ENS taken");
        id = nextId++;
        agents[id] = Agent({ owner: msg.sender, ensName: ensName, role: role, active: true });
        idByEns[ensName] = id;
        emit AgentRegistered(id, msg.sender, ensName, role);
    }

    function deactivate(uint256 id) external {
        require(agents[id].owner == msg.sender, "not owner");
        agents[id].active = false;
        emit AgentDeactivated(id);
    }
}
