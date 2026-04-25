import { expect } from "chai";
import { ethers } from "hardhat";

describe("AgentRegistry", () => {
  it("registers an agent and emits AgentRegistered with sequential id", async () => {
    const [, alice] = await ethers.getSigners();
    const reg = await (await ethers.getContractFactory("AgentRegistry")).deploy();
    await reg.waitForDeployment();

    const tx = await reg.connect(alice).register("alice.tribunal.eth", "judge");
    const rc = await tx.wait();
    const ev = rc!.logs
      .map((l) => {
        try { return reg.interface.parseLog(l as any); } catch { return null; }
      })
      .find((e) => e?.name === "AgentRegistered");
    expect(ev).to.exist;
    expect(ev!.args.id).to.equal(1n);
    expect(ev!.args.owner).to.equal(await alice.getAddress());
    expect(ev!.args.ensName).to.equal("alice.tribunal.eth");
    expect(ev!.args.role).to.equal("judge");
  });

  it("rejects re-registration of the same ENS name", async () => {
    const [, a, b] = await ethers.getSigners();
    const reg = await (await ethers.getContractFactory("AgentRegistry")).deploy();
    await reg.connect(a).register("alice.tribunal.eth", "judge");
    await expect(
      reg.connect(b).register("alice.tribunal.eth", "lawyer"),
    ).to.be.revertedWith("ENS taken");
  });

  it("rejects empty ENS name", async () => {
    const [, a] = await ethers.getSigners();
    const reg = await (await ethers.getContractFactory("AgentRegistry")).deploy();
    await expect(reg.connect(a).register("", "judge")).to.be.revertedWith("empty ens");
  });

  it("only owner can deactivate", async () => {
    const [, a, b] = await ethers.getSigners();
    const reg = await (await ethers.getContractFactory("AgentRegistry")).deploy();
    await reg.connect(a).register("alice.tribunal.eth", "judge");
    await expect(reg.connect(b).deactivate(1)).to.be.revertedWith("not owner");
    await expect(reg.connect(a).deactivate(1)).to.emit(reg, "AgentDeactivated").withArgs(1);
  });
});
