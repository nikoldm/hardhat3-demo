import { network } from "hardhat";

const { ethers } = await network.connect();

async function main() {
    const [owner] = await ethers.getSigners();
    console.log("所有者:", owner.address);

    // 1. 需要升级的代理地址
    const proxyAddress = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0"; // 替换为代理地址
    console.log("代理地址:", proxyAddress);

    // 2. 连接到当前合约
    const nftAuction = await ethers.getContractAt("NftAuction", proxyAddress);

    console.log("当前状态:");
    console.log("- 所有者:", await nftAuction.owner());
    console.log("- 拍卖数量:", await nftAuction.auctionCounter());
    console.log("- 平台手续费:", await nftAuction.platformFee());

    // 3. 部署 V2 实现
    console.log("\n部署 V2 实现合约...");
    const NftAuctionV2 = await ethers.getContractFactory("NftAuctionV2");
    const v2Implementation = await NftAuctionV2.deploy();
    await v2Implementation.waitForDeployment();

    const v2Address = await v2Implementation.getAddress();
    console.log("V2 实现地址:", v2Address);

    // 4. 检查当前实现
    const implementationSlot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
    const currentImpl = await ethers.provider.getStorage(proxyAddress, implementationSlot);
    console.log("当前实现地址:", "0x" + currentImpl.slice(26));

    // 5. 升级合约
    console.log("\n开始升级...");
    const upgradeIface = new ethers.Interface([
        "function upgradeToAndCall(address,bytes) external payable"
    ]);

    const upgradeData = upgradeIface.encodeFunctionData("upgradeToAndCall", [
        v2Address,
        "0x"
    ]);

    const tx = await owner.sendTransaction({
        to: proxyAddress,
        data: upgradeData,
        value: 0
    });

    const receipt = await tx.wait();

    // 6. 验证升级
    const newImpl = await ethers.provider.getStorage(proxyAddress, implementationSlot);
    console.log("新实现地址:", "0x" + newImpl.slice(26));

    // 7. 连接到 V2 合约
    const nftAuctionV2 = await ethers.getContractAt("NftAuctionV2", proxyAddress);

    console.log("\n升级后状态:");
    console.log("- 版本:", await nftAuctionV2.getVersion());
    console.log("- 最后升级时间:", await nftAuctionV2.getLastUpgradeTime());
    console.log("- 拍卖数量:", await nftAuctionV2.auctionCounter());

    console.log("\n 升级完成");
}

main().catch(console.error);