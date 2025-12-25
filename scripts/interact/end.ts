import { network } from "hardhat";

const { ethers } = await network.connect();
// 结束拍卖
async function end() {
    console.log("\n=== 结束拍卖 ===");
    const [deployer, bidder] = await ethers.getSigners();

    console.log("部署者地址:", deployer.address);
    console.log("出价者地址:", bidder.address);

    const nftAuction = await ethers.getContractAt("NftAuction", "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512");

    const auctionId = 0; // 替换为实际的拍卖ID

    try {
        // 检查是否可以结束
        const auction = await nftAuction.auctions(auctionId);
        console.log("拍卖结束时间:", auction.endTime.toString());

        // 如果拍卖已结束，可以执行结束
        const tx = await nftAuction.connect(deployer).endAuction(auctionId);
        const receipt = await tx.wait();
        if (!receipt) {
            throw new Error("交易收据为null");
        }
        console.log("结束拍卖成功！");
        console.log("交易哈希:", receipt.hash);

        // 查看拍卖结果
        const auctionResult = await nftAuction.auctions(auctionId);
        console.log("最终拍卖状态:", auctionResult);

    } catch (error) {
        console.error("结束拍卖失败:", error);
    }
}

end().catch(console.error);