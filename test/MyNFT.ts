// test/MyNFT.test.ts
import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.connect();

describe("MyNFT", function () {
    let myNFT: any;
    let owner: any;
    let addr1: any;
    let addr2: any;
    let addr3: any;

    const baseURI = "https://api.example.com/nft/";
    const tokenURI1 = "token-1.json";
    const tokenURI2 = "token-2.json";
    const tokenURI3 = "token-3.json";
    const fullTokenURI1 = `${baseURI}${tokenURI1}`;

    const maxSupplyTest = 100;

    beforeEach(async function () {
        [owner, addr1, addr2, addr3] = await ethers.getSigners();

        const MyNFT = await ethers.getContractFactory("MyNFT");
        myNFT = await MyNFT.deploy();

        await myNFT.waitForDeployment();

        // 设置基础URI
        await myNFT.setBaseURI(baseURI);
    });

    describe("部署和基本信息", function () {
        it("应该正确设置名称和符号", async function () {
            expect(await myNFT.name()).to.equal("MyNFT");
            expect(await myNFT.symbol()).to.equal("MNft");
        });

        it("应该正确设置所有者", async function () {
            expect(await myNFT.owner()).to.equal(owner.address);
        });

        it("应该正确设置最大供应量", async function () {
            expect(await myNFT.maxSupply()).to.equal(maxSupplyTest);
        });
    });

    describe("铸造功能", function () {
        it("所有者可以铸造NFT给其他地址", async function () {
            await expect(myNFT.connect(owner).mintNFT(addr1.address, tokenURI1))
                .to.emit(myNFT, "MintEvent")
                .withArgs(addr1.address, 1, tokenURI1);

            expect(await myNFT.ownerOf(1)).to.equal(addr1.address);
            expect(await myNFT.tokenURI(1)).to.equal(fullTokenURI1);
            expect(await myNFT.balanceOf(addr1.address)).to.equal(1);
        });

        it("非所有者不能铸造NFT", async function () {
            await expect(
                myNFT.connect(addr1).mintNFT(addr2.address, tokenURI1)
            ).to.be.revertedWithCustomError(myNFT, "OwnableUnauthorizedAccount");
        });

        it("铸造超过最大供应量应该失败", async function () {
            // 先铸造到最大供应量
            for (let i = 0; i < maxSupplyTest; i++) {
                await myNFT.connect(owner).mintNFT(addr1.address, `token-${i}.json`);
            }

            // 验证已经铸造了 maxSupplyTest 个
            expect(await myNFT.maxSupply()).to.equal(maxSupplyTest);

            // 尝试铸造第 maxSupplyTest + 1个NFT应该失败
            await expect(
                myNFT.connect(owner).mintNFT(addr2.address, "extra-token.json")
            ).to.be.revertedWith("Max supply reached");
        });
        it("批量铸造超过最大供应量应该失败", async function () {
            // 先铸造995个，剩下5个位置
            for (let i = 0; i < maxSupplyTest - 5; i++) {
                await myNFT.connect(owner).mintNFT(addr1.address, `token-${i}.json`);
            }

            // 尝试批量铸造6个，应该失败
            const recipients = [
                addr1.address, addr2.address, addr3.address,
                addr1.address, addr2.address, addr3.address
            ];
            const urls = ["1.json", "2.json", "3.json", "4.json", "5.json", "6.json"];

            await expect(
                myNFT.connect(owner).batchMintNFT(recipients, urls)
            ).to.be.revertedWith("Batch Exceeds max supply!!!");

            // 批量铸造5个，应该成功
            const recipients5 = recipients.slice(0, 5);
            const urls5 = urls.slice(0, 5);

            await myNFT.connect(owner).batchMintNFT(recipients5, urls5);

            expect(await myNFT.maxSupply()).to.equal(maxSupplyTest);
        });

        it("批量铸造功能正常工作", async function () {
            const recipients = [addr1.address, addr2.address, addr3.address];
            const urls = [tokenURI1, tokenURI2, tokenURI3];

            await myNFT.connect(owner).batchMintNFT(recipients, urls);

            expect(await myNFT.ownerOf(1)).to.equal(addr1.address);
            expect(await myNFT.ownerOf(2)).to.equal(addr2.address);
            expect(await myNFT.ownerOf(3)).to.equal(addr3.address);

            expect(await myNFT.tokenURI(1)).to.equal(fullTokenURI1);
            expect(await myNFT.balanceOf(addr1.address)).to.equal(1);
            expect(await myNFT.balanceOf(addr2.address)).to.equal(1);
            expect(await myNFT.balanceOf(addr3.address)).to.equal(1);
        });

        it("批量铸造时数组长度不匹配应该失败", async function () {
            const recipients = [addr1.address, addr2.address];
            const urls = [tokenURI1]; // 长度不匹配

            await expect(
                myNFT.connect(owner).batchMintNFT(recipients, urls)
            ).to.be.revertedWith("arrays length mismatch.");
        });
    });

    describe("授权功能", function () {
        beforeEach(async function () {
            // 先铸造一个NFT给addr1
            await myNFT.connect(owner).mintNFT(addr1.address, tokenURI1);
        });

        it("NFT所有者可以授权给其他地址", async function () {
            // addr1 授权给 addr2
            await myNFT.connect(addr1).approve(addr2.address, 1);

            expect(await myNFT.getApproved(1)).to.equal(addr2.address);
        });

        it("授权地址可以转移NFT", async function () {
            // addr1 授权给 addr2
            await myNFT.connect(addr1).approve(addr2.address, 1);

            // addr2 可以转移NFT给addr3
            await myNFT.connect(addr2).transferFrom(addr1.address, addr3.address, 1);

            expect(await myNFT.ownerOf(1)).to.equal(addr3.address);
            expect(await myNFT.balanceOf(addr1.address)).to.equal(0);
            expect(await myNFT.balanceOf(addr3.address)).to.equal(1);
        });

        it("非授权地址不能转移NFT", async function () {
            // addr2 没有授权，尝试转移应该失败
            await expect(
                myNFT.connect(addr2).transferFrom(addr1.address, addr3.address, 1)
            ).to.be.revertedWithCustomError(myNFT, "ERC721InsufficientApproval");
        });

        it("所有者可以设置或取消对全部NFT的授权", async function () {
            // 铸造另一个NFT
            await myNFT.connect(owner).mintNFT(addr1.address, tokenURI2);

            // addr1 设置对所有NFT的授权给addr2
            await myNFT.connect(addr1).setApprovalForAll(addr2.address, true);

            expect(await myNFT.isApprovedForAll(addr1.address, addr2.address)).to.be.true;

            // addr2 可以转移两个NFT
            await myNFT.connect(addr2).transferFrom(addr1.address, addr3.address, 1);
            await myNFT.connect(addr2).transferFrom(addr1.address, addr3.address, 2);

            expect(await myNFT.balanceOf(addr1.address)).to.equal(0);
            expect(await myNFT.balanceOf(addr3.address)).to.equal(2);
        });
    });

    describe("转移功能", function () {
        beforeEach(async function () {
            // 铸造NFT给addr1
            await myNFT.connect(owner).mintNFT(addr1.address, tokenURI1);
        });

        it("NFT所有者可以转移自己的NFT", async function () {
            await myNFT.connect(addr1).transferFrom(addr1.address, addr2.address, 1);

            expect(await myNFT.ownerOf(1)).to.equal(addr2.address);
        });

        it("所有者可以通过transferNFT函数转移任何NFT", async function () {
            // 先授权
            // await myNFT.connect(addr1).setApprovalForAll(owner.address, true);

            await myNFT.connect(owner).transferNFT(addr1.address, addr2.address, 1);
            expect(await myNFT.ownerOf(1)).to.equal(addr2.address);
        });

        it("transferNFT只能由所有者调用", async function () {
            await expect(
                myNFT.connect(addr2).transferNFT(addr1.address, addr2.address, 1)
            ).to.be.revertedWithCustomError(myNFT, "OwnableUnauthorizedAccount");
        });

        it("transferNFT只能转移正确所有者的NFT", async function () {
            // addr1的NFT，但尝试从owner地址转移应该失败
            await expect(
                myNFT.connect(owner).transferNFT(owner.address, addr2.address, 1)
            ).to.be.revertedWith("Transfer from incorrect owner");
        });

        it("安全转移功能正常工作", async function () {
            // 测试安全转移给合约地址（如果有onERC721Received函数）
            const ERC721ReceiverMock = await ethers.getContractFactory("ERC721ReceiverMock");
            const receiver = await ERC721ReceiverMock.deploy();

            await myNFT.connect(addr1)["safeTransferFrom(address,address,uint256)"](
                addr1.address,
                await receiver.getAddress(),
                1
            );

            expect(await myNFT.ownerOf(1)).to.equal(await receiver.getAddress());
        });
    });

    describe("元数据功能", function () {
        beforeEach(async function () {
            await myNFT.connect(owner).mintNFT(addr1.address, tokenURI1);
        });

        it("应该正确返回tokenURI", async function () {
            expect(await myNFT.tokenURI(1)).to.equal(fullTokenURI1);
        });

        it("可以更新基础URI", async function () {
            const newBaseURI = "https://new-api.example.com/nft/";
            await myNFT.connect(owner).setBaseURI(newBaseURI);

            expect(await myNFT.tokenURI(1)).to.equal(`${newBaseURI}${tokenURI1}`);
        });
    });

    describe("接口支持", function () {
        it("应该正确报告接口支持", async function () {
            // ERC721 接口ID
            const ERC721_INTERFACE_ID = "0x80ac58cd";
            // ERC721Metadata 接口ID
            const ERC721_METADATA_INTERFACE_ID = "0x5b5e139f";
            // ERC165 接口ID
            const ERC165_INTERFACE_ID = "0x01ffc9a7";

            expect(await myNFT.supportsInterface(ERC721_INTERFACE_ID)).to.be.true;
            expect(await myNFT.supportsInterface(ERC721_METADATA_INTERFACE_ID)).to.be.true;
            expect(await myNFT.supportsInterface(ERC165_INTERFACE_ID)).to.be.true;
        });
    });
});