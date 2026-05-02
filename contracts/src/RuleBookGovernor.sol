// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title RuleBookGovernor
/// @notice Open-address governance for the Tribunal rulebook. Stores the
///         0G Storage rootHash of the base rulebook plus an append-only
///         list of amendment rootHashes. Anyone can propose; one address
///         = one vote. Quorum is fixed at construction (2 in tests).
///
///         The `humanityOracle` slot is reserved: when set, votes will be
///         gated through the oracle (World ID / Proof of Humanity). Today
///         it is unset (address(0) = open).
contract RuleBookGovernor {
    struct Amendment {
        bytes32 cidRoot;     // 0G Storage rootHash of the amendment text
        string  cidUrl;      // human-readable pointer (storagescan link)
        string  title;
        uint64  appliedAt;
    }

    struct Proposal {
        address proposer;
        string  title;
        bytes32 cidRoot;
        string  cidUrl;
        uint32  yes;
        uint32  no;
        bool    executed;
    }

    bytes32 public immutable baseRoot;
    string  public           baseUrl;
    Amendment[] private _amendments;
    Proposal[]  private _proposals;
    mapping(uint256 => mapping(address => bool)) private _voted;

    address public humanityOracle;     // address(0) = open voting
    uint32  public quorum;             // simple yes-vote threshold

    event Proposed(uint256 indexed id, address indexed proposer, string title, bytes32 cidRoot);
    event Voted(uint256 indexed id, address indexed voter, bool support);
    event Executed(uint256 indexed id, bytes32 cidRoot);

    constructor(bytes32 baseRoot_, string memory baseUrl_) {
        require(baseRoot_ != bytes32(0), "zero base root");
        baseRoot = baseRoot_;
        baseUrl = baseUrl_;
        quorum = 2; // demo default; bump via redeploy when panel grows
    }

    function amendmentCount() external view returns (uint256) { return _amendments.length; }
    function amendmentAt(uint256 i) external view returns (Amendment memory) { return _amendments[i]; }
    function proposalCount() external view returns (uint256) { return _proposals.length; }
    function proposalAt(uint256 i) external view returns (Proposal memory) { return _proposals[i]; }

    function propose(string calldata title, bytes32 cidRoot, string calldata cidUrl)
        external returns (uint256 id)
    {
        require(cidRoot != bytes32(0), "zero cid root");
        id = _proposals.length;
        _proposals.push(Proposal({
            proposer: msg.sender, title: title, cidRoot: cidRoot, cidUrl: cidUrl,
            yes: 0, no: 0, executed: false
        }));
        emit Proposed(id, msg.sender, title, cidRoot);
    }

    function vote(uint256 id, bool support) external {
        require(id < _proposals.length, "no such proposal");
        require(!_voted[id][msg.sender], "already voted");
        _voted[id][msg.sender] = true;
        if (support) _proposals[id].yes += 1; else _proposals[id].no += 1;
        emit Voted(id, msg.sender, support);
    }

    function execute(uint256 id) external {
        Proposal storage p = _proposals[id];
        require(!p.executed, "already executed");
        require(p.yes >= quorum, "quorum not met");
        p.executed = true;
        _amendments.push(Amendment({
            cidRoot: p.cidRoot, cidUrl: p.cidUrl, title: p.title, appliedAt: uint64(block.timestamp)
        }));
        emit Executed(id, p.cidRoot);
    }

    /// keccak256(base || amend_0_root || amend_1_root || ...). Anyone can
    /// recompute this off-chain from baseRoot + amendmentAt(i).cidRoot.
    function currentManifestHash() external view returns (bytes32 h) {
        h = baseRoot;
        for (uint256 i = 0; i < _amendments.length; i++) {
            h = keccak256(abi.encodePacked(h, _amendments[i].cidRoot));
        }
    }
}
