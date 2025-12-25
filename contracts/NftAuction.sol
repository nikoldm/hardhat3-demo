// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * 拍卖合约
 */
contract NftAuction is
    Initializable,
    UUPSUpgradeable,
    OwnableUpgradeable,
    IERC721Receiver,
    ReentrancyGuardUpgradeable
{
    // 拍卖结构体
    struct Auction {
        // uint256 auctionId; //拍卖ID
        address seller; // 卖家地址
        address nftContract; // NFT合约地址
        uint256 tokenId; // NFT Token ID
        address paymentToken; // 支付代币地址（address(0) 表示ETH）
        uint256 startPrice; // 起拍价（以支付代币计）
        uint256 rate; // 出价增长速率（如10%）
        uint256 startTime; // 拍卖开始时间
        uint256 endTime; // 拍卖结束时间
        address highestBidder; // 当前最高出价者
        uint256 highestBid; // 当前最高出价
        bool ended; // 拍卖是否结束
    }
    // address factory; // 工厂合约地址，用于调用工厂合约的相关函数（如计算手续费，把手续费转给平台）

    // 拍卖Id和信息映射
    mapping(uint256 => Auction) public auctions;
    // 出价返还映射
    mapping(address => uint256) public bidRefundsETH;
    mapping(uint256 => mapping(address => uint256)) public bidRefundsERC20;

    // ChainLink价格预言机
    AggregatorV3Interface internal ethPriceFeed;

    mapping(address => AggregatorV3Interface) public erc20PriceFeeds; // ERC20代币价格预言机

    // 拍卖ID自增计数
    uint256 public auctionCounter;

    // 手续费 百分比 100 = 1%
    uint256 public platformFee = 10; // 10%
    // 手续费接收地址
    address public platformFeeRecipient;

    // 事件：创建拍卖
    event AuctionCreated(
        uint256 indexed auctionId,
        address seller,
        address nftContract,
        uint256 indexed tokenId,
        address paymentToken,
        uint256 startPrice,
        uint256 startTime,
        uint256 endTime
    );

    // 事件：出价
    event BidPlaced(
        uint256 indexed auctionId,
        address bidder,
        uint256 bidAmount,
        uint256 amountInUSD
    );

    // 事件：结束拍卖
    event AuctionEnded(
        uint256 indexed auctionId,
        address highestBidder,
        uint256 highestBid
    );

    // 无人出价
    event NoBodyBids(uint256 indexed auctionId);

    // 禁用初始值设定函数
    constructor() {
        _disableInitializers();
    }
    /**
     * 初始化函数（代替构造函数）
     * @param _ethPriceFeed ETH/USD价格预言机地址
     * @param _platformFeeRecipient 手续费接收地址
     */
    function initialize(
        address _ethPriceFeed,
        address _platformFeeRecipient
    ) public initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        ethPriceFeed = AggregatorV3Interface(_ethPriceFeed);
        platformFeeRecipient = _platformFeeRecipient;
        auctionCounter = 0;
        platformFee = 200; // 2%
    }

    /**
     * 创建新的拍卖
     * @param _nftContract NFT合约地址
     * @param _tokenId NFT Token ID
     * @param _paymentToken 支付代币地址（address(0) 表示ETH）
     * @param _rate 出价增长速率（如10%输入10）
     * @param _startPrice 起拍价
     * @param _duration 拍卖持续时间（秒）
     */
    function createAuction(
        address _nftContract,
        uint256 _tokenId,
        address _paymentToken,
        uint256 _rate,
        uint256 _startPrice,
        uint256 _duration //拍卖持续时间（秒）
    ) public {
        require(_startPrice > 0, "Start price must be greater than 0");
        require(_duration > 0, "Duration must be > 0");
        require(
            _nftContract != address(0),
            "NFT contract address cannot be zero"
        );
        require(_tokenId > 0, "Token ID must be greater than 0");

        // 转移NFT所有权到拍卖合约
        IERC721(_nftContract).transferFrom(msg.sender, address(this), _tokenId);

        // 创建新的拍卖
        uint256 _Counter = auctionCounter++;
        auctions[_Counter] = Auction({
            seller: msg.sender,
            nftContract: _nftContract,
            tokenId: _tokenId,
            paymentToken: _paymentToken,
            rate: _rate,
            startPrice: _startPrice,
            startTime: block.timestamp,
            endTime: block.timestamp + _duration,
            highestBidder: address(0),
            highestBid: 0,
            ended: false
        });

        // 触发创建拍卖事件
        emit AuctionCreated(
            _Counter,
            msg.sender,
            _nftContract,
            _tokenId,
            _paymentToken,
            _startPrice,
            block.timestamp,
            block.timestamp + _duration
        );
    }
    /**
     * 出价
     */
    function bid(
        uint256 _auctionId,
        uint256 _bidAmount
    ) public payable virtual {
        Auction storage auction = auctions[_auctionId];
        require(!auction.ended, "Auction has ended");
        require(
            block.timestamp >= auction.startTime,
            "Auction has not started yet"
        );
        require(block.timestamp < auction.endTime, "Auction has ended");

        // 检查出价金额是否足够
        uint256 bidRateAmount = auction.highestBid > 0
            ? (auction.highestBid * (100 + auction.rate)) / 100
            : auction.startPrice;
        require(
            _bidAmount >= bidRateAmount,
            "Bid amount must be at least % higher than the current highest bid"
        );

        if (auction.paymentToken == address(0)) {
            // 使用ETH支付
            require(msg.value == _bidAmount, "Incorrect ETH amount sent");
            if (auction.highestBidder != address(0)) {
                bidRefundsETH[auction.highestBidder] += auction.highestBid;
            }
        } else {
            // 使用ERC20代币支付
            require(msg.value == 0, "ETH not accepted for ERC20 auctions");
            require(
                IERC20(auction.paymentToken).transferFrom(
                    msg.sender,
                    address(this),
                    _bidAmount
                ),
                "ERC20 transfer failed"
            );
            if (auction.highestBidder != address(0)) {
                bidRefundsERC20[_auctionId][auction.highestBidder] += auction
                    .highestBid;
            }
        }

        // 更新最高出价者和出价
        auction.highestBidder = msg.sender;
        auction.highestBid = _bidAmount;

        // 计算美元价值
        uint256 amountInUSD = getAuctionValueInUSD(
            auction.paymentToken,
            _bidAmount
        );
        emit BidPlaced(_auctionId, msg.sender, _bidAmount, amountInUSD);
    }

    /**
     * 提取出价后未中标，返还的资金
     */
    function claimBidRefund(uint256 _auctionId) public nonReentrant {
        Auction storage auction = auctions[_auctionId];
        require(auction.ended, "Auction has not ended yet");
        require(
            auction.highestBidder != msg.sender,
            "You are the highest bidder"
        );

        if (auction.paymentToken == address(0)) {
            // 使用ETH支付
            uint256 refundAmount = bidRefundsETH[msg.sender];
            require(refundAmount > 0, "No refund amount available");
            bidRefundsETH[msg.sender] = 0;
            payable(msg.sender).transfer(refundAmount);
        } else {
            // 使用ERC20代币支付
            uint256 refundAmount = bidRefundsERC20[_auctionId][msg.sender];
            require(refundAmount > 0, "No refund amount available");
            bidRefundsERC20[_auctionId][msg.sender] = 0;
            IERC20(auction.paymentToken).transfer(msg.sender, refundAmount);
        }
    }

    /**
     * 获取拍卖价值（美元）
     * @param _paymentToken 支付代币地址
     */
    function getAuctionValueInUSD(
        address _paymentToken,
        uint256 _amount
    ) public view returns (uint256) {
        // 这里可以实现获取代币价值的逻辑，例如通过API调用或预设的汇率
        // 为了简化示例，假设1个ERC20代币=1美元
        int256 price;
        uint80 decimals;
        if (_paymentToken == address(0)) {
            price = getLatestETHPrice();
            (, , , , decimals) = ethPriceFeed.latestRoundData();
        } else {
            price = getLatestERC20Price(_paymentToken);
            AggregatorV3Interface priceFeed = erc20PriceFeeds[_paymentToken];
            (, , , , decimals) = priceFeed.latestRoundData();
        }
        require(price > 0, "Invalid price");

        // 计算美元价值：amount * price / 10^decimals
        return (_amount * uint256(price)) / (10 ** decimals);
    }

    /**
     * @dev 获取ETH/USD价格
     * @return 最新ETH价格（美元，8位小数）
     */
    function getLatestETHPrice() public view returns (int256) {
        (, int256 price, , , ) = ethPriceFeed.latestRoundData();
        return price;
    }

    /**
     * @dev 获取ERC20/USD价格
     * @param token ERC20代币地址
     * @return 最新价格（美元，8位小数）
     */
    function getLatestERC20Price(address token) public view returns (int256) {
        AggregatorV3Interface priceFeed = erc20PriceFeeds[token];
        require(address(priceFeed) != address(0), "Price feed not found");

        (, int256 price, , , ) = priceFeed.latestRoundData();
        return price;
    }

    /**
     * 结束拍卖并转移NFT和代币
     * @param _auctionId 拍卖ID
     */
    function endAuction(uint256 _auctionId) external virtual {
        Auction storage auction = auctions[_auctionId];
        require(!auction.ended, "Auction has already ended");
        require(
            block.timestamp >= auction.endTime,
            "Auction has not ended yet"
        );

        auction.ended = true;

        if (auction.highestBidder == address(0)) {
            // 没有出价者，NFT返回给卖家
            IERC721(auction.nftContract).transferFrom(
                address(this),
                auction.seller,
                auction.tokenId
            );
            emit NoBodyBids(_auctionId);
            return;
        }

        // 计算手续费
        uint256 fee = (auction.highestBid * platformFee) / 10000;
        uint256 sellerAmount = auction.highestBid - fee;

        // 转移NFT到最高出价者
        IERC721(auction.nftContract).transferFrom(
            address(this),
            auction.highestBidder,
            auction.tokenId
        );

        // 转移支付代币到卖家
        if (auction.paymentToken == address(0)) {
            // 使用ETH支付
            payable(auction.seller).transfer(sellerAmount);
            // 转移手续费到平台
            payable(platformFeeRecipient).transfer(fee);
        } else {
            // 使用ERC20代币支付
            IERC20(auction.paymentToken).transfer(auction.seller, sellerAmount);
            // 转移手续费到平台
            IERC20(auction.paymentToken).transfer(platformFeeRecipient, fee);
        }
        emit AuctionEnded(
            _auctionId,
            auction.highestBidder,
            auction.highestBid
        );
    }

    /**
     * 设置ERC20价格预言机
     * @param token ERC20代币地址
     * @param priceFeed Chainlink预言机地址
     */
    function setERC20PriceFeed(
        address token,
        address priceFeed
    ) external onlyOwner {
        erc20PriceFeeds[token] = AggregatorV3Interface(priceFeed);
    }

    /**
     * 设置平台手续费
     * @param _platformFee 手续费（百分比，如10%输入10）
     */
    function setPlatformFee(uint256 _platformFee) external onlyOwner {
        require(_platformFee <= 1000, "Fee too high..");
        platformFee = _platformFee;
    }

    /**
     * 设置平台手续费接收地址
     * @param _platformFeeRecipient 手续费接收地址
     */
    function setFeeRecipient(address _platformFeeRecipient) external onlyOwner {
        require(_platformFeeRecipient != address(0), "Invalid address");
        platformFeeRecipient = _platformFeeRecipient;
    }

    /**
     * UUPS可升级合约的实现
     */
    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyOwner {}

    // // ========== 必须添加的函数 ==========
    function upgradeToAndCall(
        address newImplementation,
        bytes memory data
    ) public payable override {
        super.upgradeToAndCall(newImplementation, data);
    }

    function getRefundFee(address addr) public view returns (uint256) {
        return bidRefundsETH[addr];
    }

    /**
     * 获取拍卖信息
     * @param _auctionId 拍卖ID
     */
    function getAuctionInfo(
        uint256 _auctionId
    ) public view returns (Auction memory) {
        return auctions[_auctionId];
    }

    /**
     * 获取拍卖列表
     */
    function getAuctions() public view returns (Auction[] memory) {
        Auction[] memory auctionList = new Auction[](auctionCounter);
        for (uint256 i = 0; i < auctionCounter; i++) {
            auctionList[i] = auctions[i];
        }
        return auctionList;
    }

    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external pure override returns (bytes4) {
        return this.onERC721Received.selector;
    }
}
