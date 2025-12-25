// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./NftAuction.sol";

/**
 * NFT拍卖市场第二版，新增动态手续费功能
 */
contract NftAuctionV2 is NftAuction {
    string public version = "v1.0";
    uint256 public lastUpgradeTime;
    mapping(uint256 => uint256) public auctionFees; // 拍卖ID到实际手续费率的映射

    event DynamicFeeApplied(
        uint256 indexed auctionId,
        uint256 bidAmount,
        uint256 dynamicFee
    );

    // 构造函数
    constructor() {
        _disableInitializers();
    }

    // 重写初始化方法，增加V2版本的初始化逻辑
    function initializeV2(
        address _ethPriceFeed,
        address _platformFeeRecipient
    ) public {
        ethPriceFeed = AggregatorV3Interface(_ethPriceFeed);
        platformFeeRecipient = _platformFeeRecipient;

        platformFee = 210; // 2.1%
        version = "v2.0";
        lastUpgradeTime = block.timestamp;
        // super.initialize(_ethPriceFeed, _platformFeeRecipient);  // 调用父类初始化会报错InvalidInitialization()
    }

    // 添加新功能
    function getVersion() external view returns (string memory) {
        return version;
    }

    function getLastUpgradeTime() external view returns (uint256) {
        return lastUpgradeTime;
    }
    /**
     * @dev 动态计算手续费
     * @param bidAmount 出价金额
     * @return 实际手续费率（基点）
     */
    function calculateDynamicFee(
        uint256 bidAmount
    ) public pure returns (uint256) {
        // 动态手续费规则：
        // - 出价 < 1 ETH: 2.5% 手续费
        // - 1 ETH <= 出价 < 10 ETH: 2% 手续费
        // - 出价 >= 10 ETH: 1.5% 手续费

        // 注意：这里假设bidAmount是以wei为单位的ETH
        // 实际中应该根据支付代币类型和价格进行转换

        if (bidAmount < 1 ether) {
            return 250; // 2.5%
        } else if (bidAmount < 10 ether) {
            return 200; // 2%
        } else {
            return 150; // 1.5%
        }
    }

    /**
     * @dev 重写出价函数，添加动态手续费计算
     * @param auctionId 拍卖ID
     * @param amount 出价金额
     */
    function bid(uint256 auctionId, uint256 amount) public payable override {
        // 先调用父类的出价逻辑
        super.bid(auctionId, amount);

        // 计算并记录动态手续费
        Auction storage auction = auctions[auctionId];
        if (auction.paymentToken == address(0)) {
            // ETH拍卖，直接使用amount
            uint256 dynamicFee = calculateDynamicFee(amount);
            auctionFees[auctionId] = dynamicFee;
            auction.rate = dynamicFee;
            emit DynamicFeeApplied(auctionId, amount, dynamicFee);
        } else {
            // ERC20拍卖，需要转换为ETH价值计算
            // 这里简化处理，使用固定手续费
            auctionFees[auctionId] = platformFee;
            auction.rate = platformFee;
        }
    }

    /**
     * @dev 重写结束拍卖函数，使用动态手续费
     * @param auctionId 拍卖ID
     */
    function endAuction(uint256 auctionId) external override {
        Auction storage auction = auctions[auctionId];
        require(!auction.ended, "Auction already ended");
        require(block.timestamp >= auction.endTime, "Auction not ended yet");

        auction.ended = true;

        if (auction.highestBidder != address(0)) {
            // 使用动态手续费
            uint256 feeRate = auctionFees[auctionId] > 0
                ? auctionFees[auctionId]
                : platformFee;

            uint256 feeAmount = (auction.highestBid * feeRate) / 10000;
            uint256 sellerAmount = auction.highestBid - feeAmount;

            // 转移NFT给最高出价者
            IERC721(auction.nftContract).transferFrom(
                address(this),
                auction.highestBidder,
                auction.tokenId
            );

            // 处理资金分配
            if (auction.paymentToken == address(0)) {
                // ETH支付
                payable(auction.seller).transfer(sellerAmount);
                payable(platformFeeRecipient).transfer(feeAmount);
            } else {
                // ERC20支付
                IERC20 token = IERC20(auction.paymentToken);
                token.transfer(auction.seller, sellerAmount);
                token.transfer(platformFeeRecipient, feeAmount);
            }

            emit AuctionEnded(
                auctionId,
                auction.highestBidder,
                auction.highestBid
            );
        } else {
            // 无人出价，退回NFT
            IERC721(auction.nftContract).transferFrom(
                address(this),
                auction.seller,
                auction.tokenId
            );

            emit NoBodyBids(auctionId);
        }
    }

    /**
     * @dev 新增：批量结束拍卖
     * @param auctionIds 拍卖ID数组
     */
    function batchEndAuctions(uint256[] calldata auctionIds) external {
        for (uint256 i = 0; i < auctionIds.length; i++) {
            if (
                !auctions[auctionIds[i]].ended &&
                block.timestamp >= auctions[auctionIds[i]].endTime
            ) {
                this.endAuction(auctionIds[i]);
            }
        }
    }

    function getAuctionFee(uint256 addr) public view returns (uint256) {
        return auctionFees[addr];
    }
}
