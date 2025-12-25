import { network } from "hardhat";

const { ethers } = await network.connect();

async function main() {
    console.log("\n=== 出价 ===");

    const [deployer, bidder, otherBidder] = await ethers.getSigners();

    console.log("部署者地址:", deployer.address);
    console.log("出价者地址:", bidder.address);
    console.log("其他出价者地址:", otherBidder.address);

    const nftAuction = await ethers.getContractAt("NftAuction", "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512");

    const auctionId = 0n;

    try {
        // 1. 先查看拍卖详情
        console.log("\n=== 查看拍卖详情 ===");
        const auctionInfo = await nftAuction.getAuctionInfo(auctionId);
        console.log("拍卖详情:", {
            seller: auctionInfo.seller,
            nftContract: auctionInfo.nftContract,
            tokenId: auctionInfo.tokenId.toString(),
            paymentToken: auctionInfo.paymentToken,
            startPrice: ethers.formatEther(auctionInfo.startPrice) + " ETH",
            rate: auctionInfo.rate.toString(),
            startTime: new Date(Number(auctionInfo.startTime) * 1000).toLocaleString(),
            endTime: new Date(Number(auctionInfo.endTime) * 1000).toLocaleString(),
            highestBidder: auctionInfo.highestBidder,
            highestBid: ethers.formatEther(auctionInfo.highestBid) + " ETH",
            ended: auctionInfo.ended
        });

        // 2. 检查当前账户余额
        console.log("\n=== 账户余额 ===");
        const bidderBalance = await ethers.provider.getBalance(bidder.address);
        console.log("出价者余额:", ethers.formatEther(bidderBalance), "ETH");

        const otherBidderBalance = await ethers.provider.getBalance(otherBidder.address);
        console.log("其他出价者余额:", ethers.formatEther(otherBidderBalance), "ETH");

        // 3. 检查拍卖是否已结束
        const auction = await nftAuction.auctions(auctionId);

        // 5. 尝试较小的出价
        console.log("\n=== 第一次出价 ===");
        const bidAmount = ethers.parseEther("1");

        // 检查出价是否高于当前最高出价
        if (bidAmount <= auction.highestBid) {
            console.error("错误: 出价必须高于当前最高出价");
            console.log("当前最高出价:", ethers.formatEther(auction.highestBid), "ETH");
            console.log("你的出价:", ethers.formatEther(bidAmount), "ETH");
            return;
        }

        console.log("==出价==:", ethers.formatEther(bidAmount), "ETH");

        // 实际出价
        const tx = await nftAuction.connect(bidder).bid(auctionId, bidAmount, {
            value: bidAmount
        });

        console.log("交易发送，等待确认...");
        const receipt = await tx.wait();
        if (!receipt) {
            throw new Error("交易收据为null");
        }
        console.log("出价成功！交易哈希:", receipt.hash);

        // 6. 查看出价后的状态
        console.log("\n=== 出价后状态 ===");
        const updatedInfo = await nftAuction.getAuctionInfo(auctionId);
        console.log("新的最高出价:", ethers.formatEther(updatedInfo.highestBid), "ETH");
        console.log("新的最高出价者:", updatedInfo.highestBidder);

        // 7. 尝试更高出价（其他出价者）
        console.log("\n=== 第二次出价（其他出价者） ===");
        const higherBid = ethers.parseEther("1.88");

        if (higherBid <= updatedInfo.highestBid) {
            console.error("错误: 出价必须高于当前最高出价");
            return;
        }

        const tx2 = await nftAuction.connect(otherBidder).bid(auctionId, higherBid, {
            value: higherBid
        });

        await tx2.wait();
        console.log("更高出价成功！");

        // 最终状态
        const finalInfo = await nftAuction.getAuctionInfo(auctionId);
        console.log("\n=== 最终状态 ===");
        console.log("最终最高出价:", ethers.formatEther(finalInfo.highestBid), "ETH");
        console.log("最终最高出价者:", finalInfo.highestBidder);
        console.log("拍卖未结束，继续出价中...");

    } catch (error: any) {
        console.error("\n=== 详细错误信息 ===");
        console.error("错误类型:", error.constructor.name);
        console.error("错误代码:", error.code);
        console.error("错误信息:", error.message);
        console.error("错误原因:", error.reason || "无");
        console.error("错误数据:", error.data || "无");

        if (error.transaction) {
            console.error("交易详情:", error.transaction);
        }

        if (error.transactionHash) {
            console.error("交易哈希:", error.transactionHash);
        }
    }
}

main().catch((error) => {
    console.error("脚本执行失败:", error);
    process.exit(1);
});
