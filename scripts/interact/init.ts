import { network } from "hardhat";

const { ethers } = await network.connect();

async function main() {
    // 测试常量
    const ETH_ADDRESS = "0x0000000000000000000000000000000000000000";
    const ONE_DAY = 24 * 60 * 60; // 24小时

    const [deployer, user1, user2] = await ethers.getSigners();
    console.log("部署者地址:", deployer.address);
    console.log("用户1地址:", user1.address);
    console.log("用户2地址:", user2.address);

    // 代理合约地址（部署时输出的地址）
    const proxyAddress = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"; // 替换为实际地址

    // 连接到代理合约
    console.log("\n连接到代理合约...");
    const NftAuction = await ethers.getContractFactory("NftAuction");
    const nftAuction = NftAuction.attach(proxyAddress);

    console.log("合约地址:", proxyAddress);
    console.log("合约所有者:", await nftAuction.owner());

    // 示例：部署一个测试NFT用于拍卖

    console.log("\n=== 部署NFT ===");

    const TestNFT = await ethers.getContractFactory("MyNFT"); // 需要先部署一个测试NFT合约
    const testNFT = await TestNFT.deploy();
    await testNFT.waitForDeployment();

    const nftAddress = await testNFT.getAddress();
    console.log("测试NFT地址:", nftAddress);

    // 铸造一个NFT给user1
    const tx = await testNFT.connect(deployer).mintNFT(user1.address, "tokenUrl1");
    const receipt = await tx.wait();
    // 检查receipt是否为null
    if (!receipt) {
        throw new Error("交易收据为null");
    }

    // 或者使用可选链操作符
    const event = testNFT.interface.parseLog(receipt?.logs?.[0]!);
    if (!event) {
        throw new Error("交易收据为null");
    }
    const tokenId = event.args.tokenId;

    console.log("已为user1铸造NFT #1: ", tokenId);

    // 授权NFT给拍卖合约
    await testNFT.connect(user1).approve(nftAuction.target, tokenId);
    console.log("已授权拍卖合约操作NFT #", tokenId);

    // // 创建拍卖

    console.log("\n=== 创建拍卖 ===");

    try {
        const txx = await nftAuction.connect(user1).createAuction(
            nftAddress,
            tokenId,
            ETH_ADDRESS,
            10,
            ethers.parseEther("1"),
            ONE_DAY
        );

        const receiptNft = await txx.wait();
        console.log("创建拍卖成功！");
        if (!receiptNft) {
            throw new Error("交易收据为null");
        }
        console.log("交易哈希:", receiptNft.hash);
        const auctionId = await nftAuction.auctionCounter();
        // 获取拍卖ID（通常通过事件获取）
        console.log("拍卖ID:", auctionId - 1n);

    } catch (error) {
        console.error("创建拍卖失败:", error);
    }
}


main().catch(console.error);