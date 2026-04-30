// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @notice Minimal ERC-7857-compatible interface used by the Tribunal.
///         The full standard covers privacy-preserving metadata transfers;
///         we expose the fields we depend on.
interface IERC7857 {
    event MetadataRootUpdated(uint256 indexed tokenId, bytes32 newRoot);
    event MetadataTransferRequested(
        uint256 indexed tokenId,
        address indexed from,
        address indexed to,
        bytes32 ciphertextHash
    );

    function metadataRoot(uint256 tokenId) external view returns (bytes32);
    function metadataUri(uint256 tokenId) external view returns (string memory);
}
