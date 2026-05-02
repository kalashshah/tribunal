// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title RuleBook
/// @notice Append-only registry of Tribunal rulebook articles. Each entry
///         pins an article id (e.g. "7.4.2") to its ENS namehash on Sepolia
///         (e.g. namehash of `chapter-7-4-2.rulebook.tribunal.eth`). The
///         article's title and body live as ENS text records on that name —
///         this contract anchors *which* names are canonical, not the
///         content itself.
///
///         Writes are gated to the `governor` address. The deployer is the
///         initial governor (so a seed script can populate the registry in
///         one signer); after seeding, transfer to `RuleBookGovernor.sol`.
contract RuleBook {
    struct Article {
        string  articleId;   // e.g. "7.4.2"
        bytes32 ensNode;     // namehash of chapter-7-4-2.rulebook.tribunal.eth
        string  chapter;     // e.g. "7.4"
        uint64  addedAt;
    }

    address public governor;
    Article[] private _articles;
    /// keccak(articleId) → idx + 1 (0 = absent, sentinel-encoded)
    mapping(bytes32 => uint256) private _idIndex;

    event ArticleAdded(uint256 indexed idx, string articleId, bytes32 ensNode, string chapter);
    event GovernorTransferred(address indexed previousGovernor, address indexed newGovernor);

    constructor(address governor_) {
        require(governor_ != address(0), "zero governor");
        governor = governor_;
        emit GovernorTransferred(address(0), governor_);
    }

    function transferGovernor(address newGovernor) external {
        require(msg.sender == governor, "only governor");
        require(newGovernor != address(0), "zero new governor");
        emit GovernorTransferred(governor, newGovernor);
        governor = newGovernor;
    }

    function addArticle(string calldata articleId, bytes32 ensNode, string calldata chapter)
        external returns (uint256 idx)
    {
        require(msg.sender == governor, "only governor");
        require(bytes(articleId).length > 0, "empty articleId");
        require(ensNode != bytes32(0), "zero ensNode");
        bytes32 key = keccak256(bytes(articleId));
        require(_idIndex[key] == 0, "already exists");
        idx = _articles.length;
        _articles.push(Article({
            articleId: articleId,
            ensNode: ensNode,
            chapter: chapter,
            addedAt: uint64(block.timestamp)
        }));
        _idIndex[key] = idx + 1;
        emit ArticleAdded(idx, articleId, ensNode, chapter);
    }

    function articleCount() external view returns (uint256) { return _articles.length; }
    function articleAt(uint256 i) external view returns (Article memory) { return _articles[i]; }

    function getByArticleId(string calldata articleId) external view returns (Article memory) {
        uint256 idx = _idIndex[keccak256(bytes(articleId))];
        require(idx > 0, "not found");
        return _articles[idx - 1];
    }

    function exists(string calldata articleId) external view returns (bool) {
        return _idIndex[keccak256(bytes(articleId))] > 0;
    }
}
