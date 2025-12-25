// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";

contract MyNFT is ERC721, ERC721URIStorage, Ownable2Step {
    uint256 public _tokenIdCounter;
    uint256 public maxSupply = 100; // 最大供应量，100方便测试
    string public baseTokenURI;
    constructor() ERC721("MyNFT", "MNft") Ownable(msg.sender) {
        _tokenIdCounter = 1;
    }

    event MintEvent(
        address indexed recipient,
        uint256 indexed tokenId,
        string tokenUrl
    );
    /**
     * 重写 supportsInterface 函数
     */
    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721, ERC721URIStorage) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    /**
     * 设置基础 URI，用于所有 NFT 的元数据
     */
    function setBaseURI(string memory _baseTokenURI) public onlyOwner {
        baseTokenURI = _baseTokenURI;
    }

    /**
     * 重写 _baseURI 函数
     */
    function _baseURI() internal view override returns (string memory) {
        return baseTokenURI;
    }

    /**
     * 重写 tokenURI
     */
    function tokenURI(
        uint256 tokenId
    ) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        return super.tokenURI(tokenId);
    }

    /**
     *  铸造新 NFT，并将其分配给指定的收件人。
     */
    function mintNFT(
        address recipient,
        string memory tokenUrl
    ) public onlyOwner returns (uint256) {
        require(_tokenIdCounter <= maxSupply, "Max supply reached");
        uint256 tokenId = _tokenIdCounter;
        _tokenIdCounter += 1;

        _safeMint(recipient, tokenId);

        _setTokenURI(tokenId, tokenUrl); // 来自 ERC721URIStorage
        emit MintEvent(recipient, tokenId, tokenUrl);
        return tokenId;
    }

    /**
     * 批量铸造 NFT
     */
    function batchMintNFT(
        address[] memory recipients,
        string[] memory tokenUrls
    ) public onlyOwner {
        require(
            recipients.length == tokenUrls.length,
            "arrays length mismatch."
        );
        require(
            _tokenIdCounter + recipients.length - 1 <= maxSupply,
            "Batch Exceeds max supply!!!"
        );
        for (uint256 i = 0; i < tokenUrls.length; i++) {
            mintNFT(recipients[i], tokenUrls[i]);
        }
    }

    /**
     * NFT 转移 - 从 owner 的角度转移其他人的 NFT
     * 注意：合约所有者有特权转移任何 NFT
     */
    function transferNFT(
        address from,
        address to,
        uint256 tokenId
    ) public onlyOwner {
        require(ownerOf(tokenId) == from, "Transfer from incorrect owner");
        // 内部转移，绕过标准权限检查
        _transfer(from, to, tokenId);
    }
}
