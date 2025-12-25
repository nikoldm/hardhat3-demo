import { network } from "hardhat";
import { expect } from "chai";

const { ethers } = await network.connect();

describe("区块链时间测试", function () {
    // 增加区块时间的辅助函数
    const increaseTime = async (seconds: number): Promise<void> => {
        await ethers.provider.send("evm_increaseTime", [seconds]);
        await ethers.provider.send("evm_mine", []);
    };
    
    it("测试时间流逝", async function () {
        const block1 = await ethers.provider.getBlock("latest");
        const startTime = block1?.timestamp || 0;
        
        // 增加 1 天时间
        await increaseTime(24 * 60 * 60);
        
        const block2 = await ethers.provider.getBlock("latest");
        const endTime = block2?.timestamp || 0;
        
        expect(endTime - startTime).to.gt(24 * 60 * 60);
    });


    describe("时间测试 - 使用快照", function () {
        let snapshotId: string;
        
        beforeEach(async function () {
            // 在每次测试前创建一个快照
            snapshotId = await ethers.provider.send("evm_snapshot");
        });
        
        afterEach(async function () {
            // 在每次测试后恢复到快照
            await ethers.provider.send("evm_revert", [snapshotId]);
        });
        
        it("测试时间增加和恢复", async function () {
            
            const block1 = await ethers.provider.getBlock("latest");
            const startTime = block1?.timestamp || 0;
       
            // 增加1天
            await increaseTime(24 * 60 * 60);
            
            const block2 = await ethers.provider.getBlock("latest");
            const endTime = block2?.timestamp || 0;
      
            // expect(endTime - startTime).to.equal(24 * 60 * 60);
            
            // 这里不需要手动恢复，afterEach 会自动恢复
        });
        
        it("另一个测试会自动从初始状态开始", async function () {
            // 这个测试会从初始时间开始，因为 afterEach 恢复了快照
            const block1 = await ethers.provider.getBlock("latest");
            const startTime = block1?.timestamp || 0;
        
            const block2 = await ethers.provider.getBlock("latest");
            const endTime = block2?.timestamp || 0;
      
            // expect(startTime).to.equal(endTime);
        });
    });
});
