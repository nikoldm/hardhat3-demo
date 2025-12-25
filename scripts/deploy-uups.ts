import { network } from "hardhat";

const { ethers } = await network.connect();
async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("部署者:", deployer.address);

    // 1. 部署实现合约
    console.log("\n1. 部署 NftAuction 实现合约...");
    const NftAuction = await ethers.getContractFactory("NftAuction");
    const implementation = await NftAuction.deploy();
    await implementation.waitForDeployment();

    const implementationAddress = await implementation.getAddress();
    console.log("实现合约地址:", implementationAddress);

    // 2. 准备初始化数据
    console.log("\n2. 准备初始化数据...");
    const iface = new ethers.Interface([
        "function initialize(address _ethPriceFeed, address _platformFeeRecipient)"
    ]);

    // 使用实际地址替换这些
    const ethPriceFeed = deployer.address; // 测试用
    const feeRecipient = deployer.address; // 测试用

    const initializeData = iface.encodeFunctionData("initialize", [
        ethPriceFeed,
        feeRecipient
    ]);

    console.log("初始化数据:", initializeData);

    // 3. 部署代理合约
    console.log("\n3. 部署代理合约...");
    const ProxyFactory = await ethers.getContractFactory("MyERC1967Proxy");
    const proxy = await ProxyFactory.deploy(
        implementationAddress,
        initializeData
    );
    await proxy.waitForDeployment();

    const proxyAddress = await proxy.getAddress();
    console.log("代理合约地址:", proxyAddress);

    // 4. 连接到代理合约
    console.log("\n4. 连接到代理合约...");
    const nftAuction = await ethers.getContractAt("NftAuction", proxyAddress);

    console.log("合约所有者:", await nftAuction.owner());
    console.log("平台手续费:", await nftAuction.platformFee());
    console.log("手续费接收地址:", await nftAuction.platformFeeRecipient());

    console.log("\n 部署完成");
    console.log("代理地址:", proxyAddress);
    console.log("实现地址:", implementationAddress);
}

main().catch(console.error);