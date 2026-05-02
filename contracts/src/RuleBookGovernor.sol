// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

interface IRuleBook {
    function addArticle(string calldata articleId, bytes32 ensNode, string calldata chapter)
        external returns (uint256 idx);
    function exists(string calldata articleId) external view returns (bool);
}

/// @title RuleBookGovernor
/// @notice Open-address governance over the Tribunal rulebook. Each
///         proposal nominates a new article (articleId + ENS namehash +
///         chapter). One address = one vote. Once `quorum` yes-votes are
///         recorded, anyone can execute the proposal, which calls
///         `RuleBook.addArticle(...)` on the registry.
///
///         The `humanityOracle` slot is reserved for World ID / Proof of
///         Humanity gating (unset today = open voting).
contract RuleBookGovernor {
    struct Proposal {
        address proposer;
        string  title;
        string  articleId;
        bytes32 ensNode;
        string  chapter;
        uint32  yes;
        uint32  no;
        bool    executed;
    }

    IRuleBook public immutable ruleBook;
    Proposal[] private _proposals;
    mapping(uint256 => mapping(address => bool)) private _voted;

    address public humanityOracle;       // address(0) = open voting
    uint32  public immutable quorum;     // simple yes-vote threshold

    event Proposed(uint256 indexed id, address indexed proposer, string title, string articleId, bytes32 ensNode);
    event Voted(uint256 indexed id, address indexed voter, bool support);
    event Executed(uint256 indexed id, string articleId, bytes32 ensNode);

    constructor(address ruleBook_) {
        require(ruleBook_ != address(0), "zero ruleBook");
        ruleBook = IRuleBook(ruleBook_);
        quorum = 2; // demo default; bump via redeploy when panel grows
    }

    function proposalCount() external view returns (uint256) { return _proposals.length; }
    function proposalAt(uint256 i) external view returns (Proposal memory) { return _proposals[i]; }

    function propose(
        string calldata title,
        string calldata articleId,
        bytes32 ensNode,
        string calldata chapter
    ) external returns (uint256 id) {
        require(bytes(articleId).length > 0, "empty articleId");
        require(ensNode != bytes32(0), "zero ensNode");
        require(!ruleBook.exists(articleId), "article already in rulebook");
        id = _proposals.length;
        _proposals.push(Proposal({
            proposer: msg.sender,
            title: title,
            articleId: articleId,
            ensNode: ensNode,
            chapter: chapter,
            yes: 0, no: 0, executed: false
        }));
        emit Proposed(id, msg.sender, title, articleId, ensNode);
    }

    function vote(uint256 id, bool support) external {
        require(id < _proposals.length, "no such proposal");
        require(!_proposals[id].executed, "already executed");
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
        ruleBook.addArticle(p.articleId, p.ensNode, p.chapter);
        emit Executed(id, p.articleId, p.ensNode);
    }
}
