// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";

contract MyNFT is ERC721URIStorage {

    uint256 private _tokenIdCounter;

    constructor() ERC721("MyNFT", "MNFT") {}

    function mintNFT(address recipient, string memory tokenUrl) public returns (uint256) {

        _tokenIdCounter += 1;
        _mint(recipient, _tokenIdCounter);
        
        _setTokenURI(_tokenIdCounter, tokenUrl);  // 来自 ERC721URIStorage

        return _tokenIdCounter;
    }
    

}
