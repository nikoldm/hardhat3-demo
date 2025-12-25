// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract UUPSProxyDeployer {
    function deployUUPSProxy(
        address implementation,
        bytes memory data
    ) public returns (address) {
        ERC1967Proxy proxy = new ERC1967Proxy(implementation, data);
        return address(proxy);
    }
}
