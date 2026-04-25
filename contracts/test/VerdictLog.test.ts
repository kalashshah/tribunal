import { expect } from "chai";
import { ethers } from "hardhat";

describe("VerdictLog", () => {
  it("only tribunal can post; emits VerdictPosted; stores verdict", async () => {
    const [, tribunal, other] = await ethers.getSigners();
    const log = await (await ethers.getContractFactory("VerdictLog"))
      .deploy(await tribunal.getAddress());

    await expect(log.connect(other).post(1, true, ethers.id("v1")))
      .to.be.revertedWith("only tribunal");

    await expect(log.connect(tribunal).post(1, true, ethers.id("v1")))
      .to.emit(log, "VerdictPosted").withArgs(1, true, ethers.id("v1"));

    const v = await log.verdicts(1);
    expect(v.exists).to.equal(true);
    expect(v.prevailingIsAccuser).to.equal(true);
    expect(v.opinionRoot).to.equal(ethers.id("v1"));
    expect(Number(v.postedAt)).to.be.greaterThan(0);
  });

  it("rejects double-post for the same case", async () => {
    const [, tribunal] = await ethers.getSigners();
    const log = await (await ethers.getContractFactory("VerdictLog"))
      .deploy(await tribunal.getAddress());
    await log.connect(tribunal).post(1, true, ethers.id("v1"));
    await expect(
      log.connect(tribunal).post(1, false, ethers.id("v2")),
    ).to.be.revertedWith("exists");
  });
});
