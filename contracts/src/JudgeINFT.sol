// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { IERC7857 } from "./interfaces/IERC7857.sol";

/// @title JudgeINFT
/// @notice ERC-7857-compatible iNFT for judge agents. Each token carries a
///         metadata root (the keccak256 of the encrypted persona blob), a
///         metadata URI (resolves to the encrypted blob on 0G Storage), and
///         an append-only ruling-history log of case-ruling hashes.
contract JudgeINFT is ERC721, IERC7857 {
    uint256 public nextId = 1;
    mapping(uint256 => bytes32) private _root;
    mapping(uint256 => string)  private _uri;
    mapping(uint256 => bytes32[]) private _history;

    /// Address authorised to append ruling memory after a case finalises.
    /// Set once at construction; the tribunal contract appends on judges' behalf
    /// so judges don't have to send a second tx after submitting a ruling.
    address public immutable memoryWriter;

    event RulingMemoryAppended(uint256 indexed tokenId, bytes32 caseRulingHash);

    constructor(string memory name_, string memory symbol_, address memoryWriter_)
        ERC721(name_, symbol_)
    {
        memoryWriter = memoryWriter_;
    }

    function mint(address to, bytes32 root, string calldata uri) external returns (uint256 id) {
        id = nextId++;
        _safeMint(to, id);
        _root[id] = root;
        _uri[id]  = uri;
        emit MetadataRootUpdated(id, root);
    }

    function metadataRoot(uint256 id) external view override returns (bytes32) { return _root[id]; }
    function metadataUri(uint256 id) external view override returns (string memory) { return _uri[id]; }
    function rulingHistory(uint256 id) external view returns (bytes32[] memory) { return _history[id]; }

    function appendRulingMemory(uint256 id, bytes32 caseRulingHash) external {
        require(
            msg.sender == ownerOf(id) || msg.sender == memoryWriter,
            "not authorised"
        );
        _history[id].push(caseRulingHash);
        emit RulingMemoryAppended(id, caseRulingHash);
    }

    function rotateRoot(uint256 id, bytes32 newRoot, string calldata newUri) external {
        require(ownerOf(id) == msg.sender, "not owner");
        _root[id] = newRoot;
        _uri[id]  = newUri;
        emit MetadataRootUpdated(id, newRoot);
    }
}
