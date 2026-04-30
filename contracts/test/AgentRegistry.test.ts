import { expect } from "chai";
import { ethers } from "hardhat";

describe("AgentRegistry", () => {
  async function deployed() {
    const [owner, judge, lawyer, other] = await ethers.getSigners();
    const reg = await (await ethers.getContractFactory("AgentRegistry"))
      .connect(owner).deploy();
    await reg.waitForDeployment();
    return { reg, owner, judge, lawyer, other };
  }

  it("defaults to roleOf == None for unknown addresses", async () => {
    const { reg, other } = await deployed();
    expect(await reg.roleOf(await other.getAddress())).to.equal(0n);
  });

  it("admits a judge and emits RoleAdmitted", async () => {
    const { reg, owner, judge } = await deployed();
    const addr = await judge.getAddress();
    await expect(reg.connect(owner).admitJudge(addr))
      .to.emit(reg, "RoleAdmitted").withArgs(addr, 2n); // Role.Judge = 2
    expect(await reg.roleOf(addr)).to.equal(2n);
  });

  it("admits a lawyer and emits RoleAdmitted", async () => {
    const { reg, owner, lawyer } = await deployed();
    const addr = await lawyer.getAddress();
    await expect(reg.connect(owner).admitLawyer(addr))
      .to.emit(reg, "RoleAdmitted").withArgs(addr, 1n); // Role.Lawyer = 1
    expect(await reg.roleOf(addr)).to.equal(1n);
  });

  it("rejects admitJudge from non-owner", async () => {
    const { reg, judge, other } = await deployed();
    await expect(
      reg.connect(other).admitJudge(await judge.getAddress()),
    ).to.be.revertedWithCustomError(reg, "OwnableUnauthorizedAccount");
  });

  it("rejects admitLawyer from non-owner", async () => {
    const { reg, lawyer, other } = await deployed();
    await expect(
      reg.connect(other).admitLawyer(await lawyer.getAddress()),
    ).to.be.revertedWithCustomError(reg, "OwnableUnauthorizedAccount");
  });

  it("revokes a role and emits RoleRevoked with previous value", async () => {
    const { reg, owner, judge } = await deployed();
    const addr = await judge.getAddress();
    await reg.connect(owner).admitJudge(addr);
    await expect(reg.connect(owner).revoke(addr))
      .to.emit(reg, "RoleRevoked").withArgs(addr, 2n); // previous Judge
    expect(await reg.roleOf(addr)).to.equal(0n);
  });

  it("rejects revoke from non-owner", async () => {
    const { reg, owner, judge, other } = await deployed();
    await reg.connect(owner).admitJudge(await judge.getAddress());
    await expect(
      reg.connect(other).revoke(await judge.getAddress()),
    ).to.be.revertedWithCustomError(reg, "OwnableUnauthorizedAccount");
  });

  it("reverts revoke when address has no role", async () => {
    const { reg, owner, other } = await deployed();
    await expect(
      reg.connect(owner).revoke(await other.getAddress()),
    ).to.be.revertedWith("not admitted");
  });
});
