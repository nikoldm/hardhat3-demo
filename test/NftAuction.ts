import { expect } from "chai";
import { network } from "hardhat";


const { ethers } = await network.connect();

describe("NftAuction拍卖合约单元测试", function () {
    // 合约实例
    let nftAuction: any;
    let nftAuctionImplementation: any;
    let proxyDeployer: any;
    let myNFT: any;
    let mockERC20: any;
    let mockPriceFeedETH: any;
    let mockPriceFeedUSDC: any;

    // 账户
    let owner: any;
    let seller: any;
    let bidder1: any;
    let bidder2: any;
    let feeRecipient: any;

    let snapshotId: string;

    // 测试常量
    const ETH_ADDRESS = "0x0000000000000000000000000000000000000000";
    const ONE_DAY = 24 * 60 * 60; // 24小时
    const PLATFORM_FEE = 200n; // 2%

    // 增加区块时间的辅助函数
    const increaseTime = async (seconds: number): Promise<void> => {
        await ethers.provider.send("evm_increaseTime", [seconds]);
        await ethers.provider.send("evm_mine", []);
    };
    
    // UUPS 代理部署函数
    const deployUUPSProxy = async (implementation: any, initializeData: string): Promise<any> => {
        // 部署代理合约
        const ProxyFactory = await ethers.getContractFactory("MyERC1967Proxy");
        const proxy = await ProxyFactory.deploy(
            await implementation.getAddress(),
            initializeData
        );
        await proxy.waitForDeployment();
        
        // 连接到代理合约
        const contract = await ethers.getContractAt("NftAuction", await proxy.getAddress());
        return contract;
    };

    beforeEach(async function () {
        // 获取账户
        [owner, seller, bidder1, bidder2, feeRecipient] = await ethers.getSigners();
        
        //  部署 MyNFT 合约  
        const MyNFT = await ethers.getContractFactory("MyNFT");
        myNFT = await MyNFT.deploy();
        await myNFT.waitForDeployment();

        // 部署 Mock ERC20
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        mockERC20 = await MockERC20.deploy("TestToken", "TEST", 18);
        await mockERC20.waitForDeployment();

        // 部署 Mock PriceFeed 合约
        const MockPriceFeed = await ethers.getContractFactory("MockAggregatorV3");
        mockPriceFeedETH = await MockPriceFeed.deploy(18);
        await mockPriceFeedETH.waitForDeployment();
        await mockPriceFeedETH.setPrice(200000000000); // $2000 * 10^8

        mockPriceFeedUSDC = await MockPriceFeed.deploy(18);
        await mockPriceFeedUSDC.waitForDeployment();
        await mockPriceFeedUSDC.setPrice(100000000); // $1 * 10^8

        // 部署 UUPSProxyDeployer 辅助合约
        const UUPSProxyDeployer = await ethers.getContractFactory("UUPSProxyDeployer");
        proxyDeployer = await UUPSProxyDeployer.deploy();
        await proxyDeployer.waitForDeployment();

         // ========== 关键部分：手动部署可升级合约 ==========
        // 1.部署 NftAuction 合约
        const NftAuction = await ethers.getContractFactory("NftAuction");
        nftAuctionImplementation  = await NftAuction.deploy();
        await nftAuctionImplementation.waitForDeployment();

        // 2. 准备初始化数据
        const iface = new ethers.Interface([
            "function initialize(address _ethPriceFeed, address _platformFeeRecipient)"
        ]);
        const initializeData = iface.encodeFunctionData("initialize", [
            await mockPriceFeedETH.getAddress(),
            feeRecipient.address
        ]);

        // 3. 部署代理合约
         const ProxyFactory = await ethers.getContractFactory("MyERC1967Proxy");
        
         const proxy = await ProxyFactory.connect(owner).deploy(
            await nftAuctionImplementation.getAddress(),
            initializeData
        );
        await proxy.waitForDeployment();

        // 4. 连接到代理合约
        nftAuction = await ethers.getContractAt("NftAuction", await proxy.getAddress());

        // nftAuction = deployUUPSProxy(nftAuctionImplementation, initializeData);

        // ===================end =========================
        // 设置 ERC20 价格预言机
        await nftAuction.connect(owner).setERC20PriceFeed(
            await mockERC20.getAddress(),
            await mockPriceFeedUSDC.getAddress()
        );
  
        // 给 bidder1 和 bidder2 一些测试代币
        await mockERC20.mint(bidder1.address, ethers.parseEther("10000"));
        await mockERC20.mint(bidder2.address, ethers.parseEther("10000"));

        // 给 seller 铸造 NFT
        await myNFT.connect(owner).mintNFT(seller.address, "token1.json");
        await myNFT.connect(owner).mintNFT(seller.address, "token2.json");
        await myNFT.connect(owner).mintNFT(seller.address, "token3.json");
        await myNFT.connect(owner).mintNFT(seller.address, "token4.json");

        // 授权 NFT 给拍卖合约
        await myNFT.connect(seller).setApprovalForAll(
            await nftAuction.getAddress(),
            true
        );

        // 授权 ERC20 给拍卖合约
        await mockERC20.connect(bidder1).approve(
            await nftAuction.getAddress(),
            ethers.parseEther("10000")
        );
        await mockERC20.connect(bidder2).approve(
            await nftAuction.getAddress(),
            ethers.parseEther("10000")
        );
    });

    describe("初始化验证", function () {
        it("应该正确设置合约所有者", async function () {
            expect(await myNFT.owner()).to.equal(owner.address);
            expect(await nftAuction.owner()).to.equal(owner.address);
        });
        
        it("seller 应该拥有 NFT", async function () {
            expect(await myNFT.ownerOf(1)).to.equal(seller.address);
            expect(await myNFT.ownerOf(2)).to.equal(seller.address);
        });
        
        it("应该正确初始化 NftAuction", async function () {
            expect(await nftAuction.platformFeeRecipient()).to.equal(feeRecipient.address);
            expect(await nftAuction.platformFee()).to.equal(200);
            expect(await nftAuction.auctionCounter()).to.equal(0);
        });
    });
    describe("基本拍卖功能", function () {
        it("seller 可以创建拍卖", async function () {
            // seller 创建拍卖
            await nftAuction.connect(seller).createAuction(
                await myNFT.getAddress(),
                1,
                ETH_ADDRESS,
                10,
                ethers.parseEther("1"),
                ONE_DAY
            );
            
            expect(await nftAuction.auctionCounter()).to.equal(1);
            
            const auction = await nftAuction.getAuctionInfo(0);
            expect(auction.seller).to.equal(seller.address);
            expect(auction.tokenId).to.equal(1);
            expect(auction.paymentToken).to.equal(ETH_ADDRESS);
            
            // NFT 应该转移到拍卖合约
            expect(await myNFT.ownerOf(1)).to.equal(await nftAuction.getAddress());
        });
        
        it("可以完成完整的拍卖流程", async function () {
            // 1. 创建拍卖
            await nftAuction.connect(seller).createAuction(
                await myNFT.getAddress(),
                1,
                ETH_ADDRESS,
                10,
                ethers.parseEther("1"),
                ONE_DAY
            );
            
            // 2. bidder1 出价
            await nftAuction.connect(bidder1).bid(0, ethers.parseEther("1"), {
                value: ethers.parseEther("1")
            });
            
            // 3. bidder2 出更高价
            await nftAuction.connect(bidder2).bid(0, ethers.parseEther("1.1"), {
                value: ethers.parseEther("1.1")
            });
            
            // 验证当前最高出价
            const auctionBefore = await nftAuction.getAuctionInfo(0);
            expect(auctionBefore.highestBidder).to.equal(bidder2.address);
            expect(auctionBefore.highestBid).to.equal(ethers.parseEther("1.1"));
            
            // 4. 快进时间并结束拍卖
            await increaseTime(ONE_DAY);
            await nftAuction.connect(owner).endAuction(0);
            
            // 5. 验证结果
            const auctionAfter = await nftAuction.getAuctionInfo(0);
            expect(auctionAfter.ended).to.be.true;
            expect(await myNFT.ownerOf(1)).to.equal(bidder2.address);
            
            // 6. bidder1 可以提取退款
            const initialBalance = await ethers.provider.getBalance(bidder1.address);
            await nftAuction.connect(bidder1).claimBidRefund(0);
            const finalBalance = await ethers.provider.getBalance(bidder1.address);
            
            // 应该收到退款（减去 gas）
            expect(finalBalance).to.be.gt(initialBalance);
        });
    });
    
    describe("合约升级", function () {
        it("deployer 可以升级合约", async function () {
            // 创建一些数据
            await nftAuction.connect(seller).createAuction(
                await myNFT.getAddress(),
                1,
                ETH_ADDRESS,
                10,
                ethers.parseEther("1"),
                ONE_DAY
            );
            
            // 记录升级前状态
            const auctionCounterBefore = await nftAuction.auctionCounter();
            const auctionBefore = await nftAuction.getAuctionInfo(0);
   
            // 部署新的实现合约
            const NewNftAuction = await ethers.getContractFactory("NftAuctionV2");
            const v2Implementation = await NewNftAuction.connect(owner).deploy();
            await v2Implementation.waitForDeployment();
           
            // 升级合约
            // 准备初始化数据（如果需要重新初始化）
            const iface = new ethers.Interface([
                "function initializeV2(address _ethPriceFeed, address _platformFeeRecipient)"
            ]);
            const initializeData = iface.encodeFunctionData("initializeV2", [
                await mockPriceFeedETH.getAddress(),
                feeRecipient.address
            ]);
            await nftAuction.connect(owner).upgradeToAndCall(
                await v2Implementation.getAddress(),
                initializeData, 
                // "0x",  // 空数据，只升级不调用
                { value: 0 } // 不需要支付ETH
            );
            
            // 重新连接到升级后的合约（使用新的 ABI）
            const nftAuctionV2 = await ethers.getContractAt("NftAuctionV2",await nftAuction.getAddress());
           
            // await nftAuctionV2.connect(owner).initializeV2(await mockPriceFeedETH.getAddress(), feeRecipient.address);
            // 验证状态保持不变
            expect(await nftAuctionV2.auctionCounter()).to.equal(auctionCounterBefore);

            const auctionAfter = await nftAuctionV2.getAuctionInfo(0);
            expect(auctionAfter.tokenId).to.equal(auctionBefore.tokenId);
            expect(auctionAfter.seller).to.equal(auctionBefore.seller);
            
            // 测试新功能
            if (typeof nftAuctionV2.version === 'function') {
                const version = await nftAuctionV2.getVersion();
                expect(version).to.equal("v2.0");
                const dynamicFee = await nftAuctionV2.calculateDynamicFee(7000000000000000000n);
                expect(dynamicFee).to.equal(200);
            }
        });
    });
    describe("合约升级后", function () {
        it("应该可以在升级后调用新功能", async function () {
            // 升级到 V2
            const NftAuctionV2 = await ethers.getContractFactory("NftAuctionV2");
            const v2Implementation = await NftAuctionV2.connect(owner).deploy();
            await v2Implementation.waitForDeployment();
            
            // 升级
            const upgradeIface = new ethers.Interface([
                "function upgradeToAndCall(address newImplementation, bytes memory data)"
            ]);
            
            const upgradeData = upgradeIface.encodeFunctionData("upgradeToAndCall", [
                await v2Implementation.getAddress(),
                "0x"  // 没有调初始化函数
            ]);
            
            await owner.sendTransaction({
                to: await nftAuction.getAddress(),
                data: upgradeData,
                value: 0
            });
            
            // 重新连接v2
            const nftAuctionV2 = await ethers.getContractAt(
                "NftAuctionV2",
                await nftAuction.getAddress()
            );
            // 部署后调初始化函数
            await nftAuctionV2.connect(owner).initializeV2(await mockPriceFeedETH.getAddress(),feeRecipient.address);

            // 测试新功能
            const version = await nftAuctionV2.getVersion();
            expect(version).to.equal("v2.0");
            
            const lastUpgradeTime = await nftAuctionV2.getLastUpgradeTime();
            expect(lastUpgradeTime).to.be.gt(0n);
            
            // 测试动态费用计算
            // console.log("Dynamic fee for init:", await nftAuctionV2.platformFee());
            const dynamicFee = await nftAuctionV2.calculateDynamicFee(17000000000000000000n); // 17 ETH
            // console.log("Dynamic fee for 150:", dynamicFee);
            expect(dynamicFee).to.equal(150);

//  ====================================================
            // 1. 创建拍卖
            await nftAuctionV2.connect(seller).createAuction(
                await myNFT.getAddress(),
                1,
                ETH_ADDRESS,
                10,
                ethers.parseEther("1"),
                ONE_DAY
            );
            
            // 2. bidder1 出价
            await nftAuctionV2.connect(bidder1).bid(0, ethers.parseEther("1"), {
                value: ethers.parseEther("1")
            });
    
            // 3. bidder2 出更高价
            await nftAuctionV2.connect(bidder2).bid(0, ethers.parseEther("333"), {
                value: ethers.parseEther("333")
            });
         
            // 验证当前最高出价
            const auctionBefore = await nftAuctionV2.getAuctionInfo(0);
            
            expect(auctionBefore.highestBidder).to.equal(bidder2.address);
            expect(auctionBefore.highestBid).to.equal(ethers.parseEther("333"));
            
            // 4. 快进时间并结束拍卖
            await increaseTime(ONE_DAY);
            await nftAuctionV2.connect(owner).endAuction(0);
            
            // 5. 验证结果
            const auctionAfter = await nftAuctionV2.getAuctionInfo(0);

            expect(auctionAfter.ended).to.be.true;
            expect(await myNFT.ownerOf(1)).to.equal(bidder2.address);
            
            // 6. bidder1 可以提取退款
            const initialBalance = await ethers.provider.getBalance(bidder1.address);
            await nftAuctionV2.connect(bidder1).claimBidRefund(0);
            const finalBalance = await ethers.provider.getBalance(bidder1.address);

            // 应该收到退款（减去 gas）
            expect(finalBalance).to.be.gt(initialBalance);

        });
    });
    describe("\nUUPS 代理部署", function () {
        it("应该通过代理正确部署和初始化", async function () {
            // 检查合约所有者
            expect(await nftAuction.owner()).to.equal(owner.address);
            
            // 检查平台手续费接收地址
            expect(await nftAuction.platformFeeRecipient()).to.equal(feeRecipient.address);
            
            // 检查手续费率
            expect(await nftAuction.platformFee()).to.equal(200); // 2%
            
            // 检查拍卖计数器
            expect(await nftAuction.auctionCounter()).to.equal(0);
            
            // 检查价格预言机设置
            const ethPrice = await nftAuction.getLatestETHPrice();
            expect(ethPrice).to.equal(200000000000);
        });

        it("应该验证代理存储模式", async function () {
            // 验证实现合约地址
            const implementationAddress = await ethers.provider.getStorage(
                await nftAuction.getAddress(),
                "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" // ERC1967 implementation slot
            );
            
            // 清除前面的0x，取后40个字符作为地址
            const implAddr = "0x" + implementationAddress.slice(26);
            expect(implAddr.toLowerCase()).to.equal(
                (await nftAuctionImplementation.getAddress()).toLowerCase()
            );
        });

        it("不能重复初始化", async function () {
            await expect(
                nftAuction.initialize(
                    await mockPriceFeedETH.getAddress(),
                    feeRecipient.address
                )
            ).to.be.revertedWithCustomError(nftAuction, "InvalidInitialization");
        });
    });

    describe("部署和初始化", function () {
        it("应该正确初始化合约", async function () {
            expect(await nftAuction.platformFeeRecipient()).to.equal(feeRecipient.address);
            expect(await nftAuction.platformFee()).to.equal(PLATFORM_FEE);
            expect(await nftAuction.auctionCounter()).to.equal(0);
        });

        it("应该正确设置预言机", async function () {
            // 检查 ETH 价格预言机
            const ethPrice = await nftAuction.getLatestETHPrice();
            expect(ethPrice).to.equal(200000000000);

            // 检查 ERC20 价格预言机
            await nftAuction.getLatestERC20Price(await mockERC20.getAddress());
        });

        it("只有所有者可以设置预言机", async function () {
            await expect(
                nftAuction.connect(seller).setERC20PriceFeed(
                    await mockERC20.getAddress(),
                    await mockPriceFeedUSDC.getAddress()
                )
            ).to.be.revertedWithCustomError(nftAuction, "OwnableUnauthorizedAccount");
        });
    });

    describe("创建拍卖", function () {
        it("应该可以创建 ETH 拍卖", async function () {
            const startPrice = ethers.parseEther("1"); // 1 ETH
            const duration = ONE_DAY;
            const rate = 10; // 10%

            // 创建拍卖前检查 NFT 所有权
            expect(await myNFT.ownerOf(1)).to.equal(seller.address);

            // 创建拍卖
            await expect(
                nftAuction.connect(seller).createAuction(
                    await myNFT.getAddress(),
                    1,
                    ETH_ADDRESS,
                    rate,
                    startPrice,
                    duration
                )
            ).to.emit(nftAuction, "AuctionCreated");

            // 检查拍卖计数器
            expect(await nftAuction.auctionCounter()).to.equal(1);

            // 检查 NFT 所有权已转移
            expect(await myNFT.ownerOf(1)).to.equal(await nftAuction.getAddress());

            // 检查拍卖信息
            const auction = await nftAuction.getAuctionInfo(0);
            // console.log("Auction Info:", auction); 
            expect(auction.seller).to.equal(seller.address);
            expect(auction.nftContract).to.equal(await myNFT.getAddress());
            expect(auction.tokenId).to.equal(1);
            expect(auction.paymentToken).to.equal(ETH_ADDRESS);
            expect(auction.startPrice).to.equal(startPrice);
            expect(auction.rate).to.equal(rate);
            expect(auction.ended).to.equal(false);
        });

        it("应该可以创建 ERC20 拍卖", async function () {
            const startPrice = ethers.parseEther("100"); // 100 TEST tokens
            const duration = ONE_DAY;
            const rate = 10; // 10%

            await expect(
                nftAuction.connect(seller).createAuction(
                    await myNFT.getAddress(),
                    2,
                    await mockERC20.getAddress(),
                    rate,
                    startPrice,
                    duration
                )
            ).to.emit(nftAuction, "AuctionCreated");

            const auction = await nftAuction.getAuctionInfo(0);
            expect(auction.paymentToken).to.equal(await mockERC20.getAddress());
        });

        it("不能创建无效的拍卖", async function () {
            await expect(
                nftAuction.connect(seller).createAuction(
                    "0x0000000000000000000000000000000000000000", // 无效地址
                    1,
                    ETH_ADDRESS,
                    10,
                    ethers.parseEther("1"),
                    ONE_DAY
                )
            ).to.be.revertedWith("NFT contract address cannot be zero");

            await expect(
                nftAuction.connect(seller).createAuction(
                    await myNFT.getAddress(),
                    0, // 无效 tokenId
                    ETH_ADDRESS,
                    10,
                    ethers.parseEther("1"),
                    ONE_DAY
                )
            ).to.be.revertedWith("Token ID must be greater than 0");

            await expect(
                nftAuction.connect(seller).createAuction(
                    await myNFT.getAddress(),
                    1,
                    ETH_ADDRESS,
                    10,
                    0, // 无效起拍价
                    ONE_DAY
                )
            ).to.be.revertedWith("Start price must be greater than 0");

            await expect(
                nftAuction.connect(seller).createAuction(
                    await myNFT.getAddress(),
                    1,
                    ETH_ADDRESS,
                    10,
                    ethers.parseEther("1"),
                    0 // 无效持续时间
                )
            ).to.be.revertedWith("Duration must be > 0");
        });

        it("需要转移 NFT 所有权", async function () {
            // 不给授权就创建拍卖
            await myNFT.connect(seller).setApprovalForAll(
                await nftAuction.getAddress(),
                false
            );

            await expect(
                nftAuction.connect(seller).createAuction(
                    await myNFT.getAddress(),
                    1,
                    ETH_ADDRESS,
                    10,
                    ethers.parseEther("1"),
                    ONE_DAY
                )
            ).to.be.revertedWithCustomError(myNFT, "ERC721InsufficientApproval");
        });
    });

    describe("ETH 拍卖出价", function () {
        let auctionId: number;

        beforeEach(async function () {
            // 创建 ETH 拍卖
            await nftAuction.connect(seller).createAuction(
                await myNFT.getAddress(),
                1,
                ETH_ADDRESS,
                10, // 10%
                ethers.parseEther("1"),
                ONE_DAY
            );
            auctionId = 0;
            snapshotId = await ethers.provider.send("evm_snapshot");
        });
        afterEach(async function () {
            // 在每次测试后恢复到快照
            await ethers.provider.send("evm_revert", [snapshotId]);
        });
        it("应该在拍卖期间出价", async function () {
            // bidder1 出价 1 ETH
            await expect(
                nftAuction.connect(bidder1).bid(auctionId, ethers.parseEther("1"), {
                    value: ethers.parseEther("1")
                })
            ).to.emit(nftAuction, "BidPlaced");

            const auction = await nftAuction.getAuctionInfo(auctionId);
            expect(auction.highestBidder).to.equal(bidder1.address);
            expect(auction.highestBid).to.equal(ethers.parseEther("1"));
        });

        it("出价必须满足最低加价", async function () {
            // 第一个出价必须是起拍价
            await expect(
                nftAuction.connect(bidder1).bid(auctionId, ethers.parseEther("0.5"), {
                    value: ethers.parseEther("0.5")
                })
            ).to.be.revertedWith("Bid amount must be at least % higher than the current highest bid");

            // 正确出价
            await nftAuction.connect(bidder1).bid(auctionId, ethers.parseEther("1"), {
                value: ethers.parseEther("1")
            });

            // 第二个出价必须至少加价 10%
            await expect(
                nftAuction.connect(bidder2).bid(auctionId, ethers.parseEther("1.05"), {
                    value: ethers.parseEther("1.05")
                })
            ).to.be.revertedWith("Bid amount must be at least % higher than the current highest bid");

            // 正确加价
            await nftAuction.connect(bidder2).bid(auctionId, ethers.parseEther("1.1"), {
                value: ethers.parseEther("1.1")
            });

            const auction = await nftAuction.getAuctionInfo(auctionId);
            expect(auction.highestBidder).to.equal(bidder2.address);
            expect(auction.highestBid).to.equal(ethers.parseEther("1.1"));
        });

        it("不能超过拍卖时间出价", async function () {
            // 快进时间到拍卖结束后
            await increaseTime(ONE_DAY + 1);

            await expect(
                nftAuction.connect(bidder1).bid(auctionId, ethers.parseEther("1"), {
                    value: ethers.parseEther("1")
                })
            ).to.be.revertedWith("Auction has ended");
        });

        it("不能在拍卖开始前出价", async function () {
            // 创建一个未来开始的拍卖
            //   const futureTime = (await time.latest()) + ONE_DAY;

            // 由于合约没有设置未来开始时间的功能，这里跳过
            // 实际测试时可以根据需要修改合约
        });

        it("出价金额必须准确", async function () {
            // 发送错误的 ETH 金额
            await expect(
                nftAuction.connect(bidder1).bid(auctionId, ethers.parseEther("1"), {
                    value: ethers.parseEther("0.9") // 金额不匹配
                })
            ).to.be.revertedWith("Incorrect ETH amount sent");
        });

        it("更新最高出价后应保存退款", async function () {
            // bidder1 出价
            await nftAuction.connect(bidder1).bid(auctionId, ethers.parseEther("1"), {
                value: ethers.parseEther("1")
            });

            // bidder2 出更高价
            await nftAuction.connect(bidder2).bid(auctionId, ethers.parseEther("1.1"), {
                value: ethers.parseEther("1.1")
            });

            // 检查 bidder1 的退款
            const refundAmount = await nftAuction.bidRefundsETH(bidder1.address);
            expect(refundAmount).to.equal(ethers.parseEther("1"));
        });
    });

    describe("ERC20 拍卖出价", function () {
        let auctionId: number;

        beforeEach(async function () {
            // 创建 ERC20 拍卖
            await nftAuction.connect(seller).createAuction(
                await myNFT.getAddress(),
                2,
                await mockERC20.getAddress(),
                10, // 10%
                ethers.parseEther("100"), // 100 TEST tokens
                ONE_DAY
            );
            auctionId = 0;
        });

        it("应该在 ERC20 拍卖中出价", async function () {
            // bidder1 出价 100 TEST
            await expect(
                nftAuction.connect(bidder1).bid(auctionId, ethers.parseEther("100"))
            ).to.emit(nftAuction, "BidPlaced");

            const auction = await nftAuction.getAuctionInfo(auctionId);
            expect(auction.highestBidder).to.equal(bidder1.address);
            expect(auction.highestBid).to.equal(ethers.parseEther("100"));
        });

        it("ERC20 拍卖不能发送 ETH", async function () {
            await expect(
                nftAuction.connect(bidder1).bid(auctionId, ethers.parseEther("100"), {
                    value: ethers.parseEther("1") // 不应该发送 ETH
                })
            ).to.be.revertedWith("ETH not accepted for ERC20 auctions");
        });
    });

    describe("结束拍卖", function () {
        let auctionId: number;

        beforeEach(async function () {
            // 创建并参与拍卖
            await nftAuction.connect(seller).createAuction(
                await myNFT.getAddress(),
                1,
                ETH_ADDRESS,
                10,
                ethers.parseEther("1"),
                ONE_DAY
            );
            auctionId = 0;

            // bidder1 和 bidder2 出价
            await nftAuction.connect(bidder1).bid(auctionId, ethers.parseEther("1"), {
                value: ethers.parseEther("1")
            });
            await nftAuction.connect(bidder2).bid(auctionId, ethers.parseEther("1.1"), {
                value: ethers.parseEther("1.1")
            });

            // 快进到拍卖结束
            await increaseTime(ONE_DAY);
        });

        it("应该正确结束拍卖", async function () {
            // 记录初始余额
            const initialSellerBalance = await ethers.provider.getBalance(seller.address);
            const initialFeeRecipientBalance = await ethers.provider.getBalance(feeRecipient.address);

            // 结束拍卖
            await expect(
                nftAuction.connect(owner).endAuction(auctionId)
            ).to.emit(nftAuction, "AuctionEnded");

            // 检查拍卖状态
            const auction = await nftAuction.getAuctionInfo(auctionId);
            expect(auction.ended).to.equal(true);

            // 检查 NFT 所有权转移
            expect(await myNFT.ownerOf(1)).to.equal(bidder2.address);

            // 检查资金分配
            const finalSellerBalance = await ethers.provider.getBalance(seller.address);
            const finalFeeRecipientBalance = await ethers.provider.getBalance(feeRecipient.address);

            // 计算手续费：1.1 ETH * 2% = 0.022 ETH
            const fee = ethers.parseEther("1.1") * PLATFORM_FEE / 10000n;
            const sellerAmount = ethers.parseEther("1.1") - fee;

            // 注意：由于 gas 费用，余额不会精确匹配
            const sellerBalanceChange = finalSellerBalance - initialSellerBalance;
            expect(sellerBalanceChange).to.be.closeTo(sellerAmount, ethers.parseEther("0.01"));

            const feeRecipientBalanceChange = finalFeeRecipientBalance - initialFeeRecipientBalance;
            expect(feeRecipientBalanceChange).to.equal(fee);
        });

        it("无人出价的拍卖应返还 NFT", async function () {
            // 创建新拍卖但不出价
            await nftAuction.connect(seller).createAuction(
                await myNFT.getAddress(),
                2,
                ETH_ADDRESS,
                10,
                ethers.parseEther("1"),
                60 // 短时间
            );

            await increaseTime(61);

            // 结束拍卖
            await expect(
                nftAuction.connect(owner).endAuction(1)
            ).to.emit(nftAuction, "NoBodyBids");

            // NFT 应返还给卖家
            expect(await myNFT.ownerOf(2)).to.equal(seller.address);
        });

        it("不能重复结束拍卖", async function () {
            // 第一次结束
            await nftAuction.connect(owner).endAuction(auctionId);

            // 第二次应该失败
            await expect(
                nftAuction.connect(owner).endAuction(auctionId)
            ).to.be.revertedWith("Auction has already ended");
        });

        it("不能在拍卖结束前结束", async function () {
            // 创建新拍卖
            await nftAuction.connect(seller).createAuction(
                await myNFT.getAddress(),
                3,
                ETH_ADDRESS,
                10,
                ethers.parseEther("1"),
                ONE_DAY
            );

            // 立即尝试结束（应该失败）
            // console.log("22222222222:", await nftAuction.getAuctions());
            await expect(
                nftAuction.connect(owner).endAuction(1)
            ).to.be.revertedWith("Auction has not ended yet");
        });
    });

    describe("提取退款", function () {
        let auctionId: number;

        beforeEach(async function () {
            // 创建并参与拍卖
            await nftAuction.connect(seller).createAuction(
                await myNFT.getAddress(),
                1,
                ETH_ADDRESS,
                10,
                ethers.parseEther("1"),
                ONE_DAY
            );
            auctionId = 0;

            // 多个出价
            await nftAuction.connect(bidder1).bid(auctionId, ethers.parseEther("1"), {
                value: ethers.parseEther("1")
            });
            await nftAuction.connect(bidder2).bid(auctionId, ethers.parseEther("1.1"), {
                value: ethers.parseEther("1.1")
            });

            // 结束拍卖
            await increaseTime(ONE_DAY);
            await nftAuction.connect(owner).endAuction(auctionId);
        });

        it("未中标者可以提取退款", async function () {
            const initialBalance = await ethers.provider.getBalance(bidder1.address);

            // bidder1 提取退款
            await nftAuction.connect(bidder1).claimBidRefund(auctionId);

            const finalBalance = await ethers.provider.getBalance(bidder1.address);

            // 应该收到 1 ETH 退款
            expect(finalBalance - initialBalance).to.be.closeTo(
                ethers.parseEther("1"),
                ethers.parseEther("0.01") // 减去 gas 费用
            );

            // 退款后余额应为0
            const refundAmount = await nftAuction.bidRefundsETH(bidder1.address);
            expect(refundAmount).to.equal(0);
        });

        it("中标者不能提取退款", async function () {
            await expect(
                nftAuction.connect(bidder2).claimBidRefund(auctionId)
            ).to.be.revertedWith("You are the highest bidder");
        });

        it("拍卖结束前不能提取退款", async function () {
            // 创建新拍卖
            await nftAuction.connect(seller).createAuction(
                await myNFT.getAddress(),
                2,
                ETH_ADDRESS,
                10,
                ethers.parseEther("1"),
                ONE_DAY
            );

            // 参与出价
            await nftAuction.connect(bidder1).bid(1, ethers.parseEther("1"), {
                value: ethers.parseEther("1")
            });
            await nftAuction.connect(bidder2).bid(1, ethers.parseEther("1.1"), {
                value: ethers.parseEther("1.1")
            });

            // 尝试在拍卖结束前提取退款
            await expect(
                nftAuction.connect(bidder1).claimBidRefund(1)
            ).to.be.revertedWith("Auction has not ended yet");
        });
    });

    describe("价格计算", function () {
        it("应该正确计算美元价值", async function () {
            // 1 ETH = $2000，测试 0.5 ETH
            const ethValue = await nftAuction.getAuctionValueInUSD(
                ETH_ADDRESS,
                ethers.parseEther("0.25")
            );
            // console.log("ETH Value in USD:", ethValue.toString());
            // 0.5 ETH * $2000 = $1000
            // 注意：预言机返回的价格有 8 位小数
            expect(ethValue).to.equal(500n * 10n ** 8n);

            // 100 TEST tokens = $100 (1 TEST = $1)
            const erc20Value = await nftAuction.getAuctionValueInUSD(
                await mockERC20.getAddress(),
                ethers.parseEther("200")
            );
            // console.log("ERC20 Value in USD:", erc20Value.toString());
            expect(erc20Value).to.equal(200n * 10n ** 8n);
        });
    });

    describe("管理功能", function () {
        it("所有者可以更新手续费", async function () {
            const newFee = 500; // 5%
            await nftAuction.connect(owner).setPlatformFee(newFee);
            expect(await nftAuction.platformFee()).to.equal(newFee);

            // 非所有者不能更新
            await expect(
                nftAuction.connect(seller).setPlatformFee(100)
            ).to.be.revertedWithCustomError(nftAuction, "OwnableUnauthorizedAccount");
        });

        it("所有者可以更新手续费接收地址", async function () {
            const newRecipient = bidder1.address;
            await nftAuction.connect(owner).setFeeRecipient(newRecipient);
            expect(await nftAuction.platformFeeRecipient()).to.equal(newRecipient);
        });

        it("不能设置无效的手续费接收地址", async function () {
            await expect(
                nftAuction.connect(owner).setFeeRecipient("0x0000000000000000000000000000000000000000")
            ).to.be.revertedWith("Invalid address");
        });
    });

    describe("获取拍卖信息", function () {
        it("应该返回所有拍卖", async function () {
            // 创建多个拍卖
            for (let i = 0; i < 3; i++) {
                await nftAuction.connect(seller).createAuction(
                    await myNFT.getAddress(),
                    i + 1,
                    ETH_ADDRESS,
                    10,
                    ethers.parseEther("1"),
                    ONE_DAY
                );
            }

            const auctions = await nftAuction.getAuctions();
            expect(auctions.length).to.equal(3);
            expect(auctions[0].tokenId).to.equal(1);
            expect(auctions[1].tokenId).to.equal(2);
            expect(auctions[2].tokenId).to.equal(3);
        });
    });
});