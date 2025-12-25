// contracts/test/ERC721ReceiverMock.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @dev Mock 测试各种转移场景的 ERC721Receiver。
 */

contract ERC721ReceiverMock {
    bytes4 private constant _ERC721_RECEIVED = 0x150b7a02;
    bytes4 private constant _ERC721_REJECTED = 0x00000000;

    function onERC721Received(
        address,
        address,
        uint256,
        bytes memory
    ) public pure returns (bytes4) {
        return _ERC721_RECEIVED;
    }

    function getAddress() public view returns (address) {
        return address(this);
    }
}
