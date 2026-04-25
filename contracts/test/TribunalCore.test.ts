import { expect } from "chai";
import { ethers } from "hardhat";

describe("TribunalCore", () => {
  async function deployed() {
    const [runner, accuser, defendant, j1, j2, j3] = await ethers.getSigners();
    const reg = await (await ethers.getContractFactory("AgentRegistry")).deploy();

    await reg.connect(accuser).register("alice.tribunal.eth", "litigant"); // id 1
    await reg.connect(defendant).register("bob.tribunal.eth", "litigant"); // 2
    await reg.connect(j1).register("judge-athena.tribunal.eth", "judge");  // 3
    await reg.connect(j2).register("judge-blackstone.tribunal.eth", "judge"); // 4
    await reg.connect(j3).register("judge-coke.tribunal.eth", "judge");    // 5

    const tc = await (await ethers.getContractFactory("TribunalCore")).deploy(await reg.getAddress());
    return { tc, reg, runner, accuser, defendant, j1, j2, j3 };
  }

  it("files a case in Filed status", async () => {
    const { tc, accuser } = await deployed();
    const tx = await tc.connect(accuser).fileCase(1, 2, ethers.ZeroAddress, 0, "ipfs://accusation");
    const rc = await tx.wait();
    const ev = rc!.logs
      .map((l) => { try { return tc.interface.parseLog(l as any); } catch { return null; } })
      .find((e) => e?.name === "CaseFiled");
    expect(ev!.args.caseId).to.equal(1n);
    expect(await tc.caseStatus(1)).to.equal(1n); // Filed
  });

  it("rejects fileCase from a non-owner of the accuser agent", async () => {
    const { tc, defendant } = await deployed();
    await expect(
      tc.connect(defendant).fileCase(1, 2, ethers.ZeroAddress, 0, "x"),
    ).to.be.revertedWith("not accuser");
  });

  it("accepts a case with assigned judges and transitions to Arguments", async () => {
    const { tc, accuser } = await deployed();
    await tc.connect(accuser).fileCase(1, 2, ethers.ZeroAddress, 0, "ipfs://x");
    await tc.acceptCase(1, [3, 4, 5], 2); // panel of 3, threshold 2
    expect(await tc.caseStatus(1)).to.equal(3n); // Arguments
    expect(await tc.caseJudges(1)).to.deep.equal([3n, 4n, 5n]);
    expect(await tc.caseThreshold(1)).to.equal(2n);
  });

  it("rejects acceptCase from non-runner", async () => {
    const { tc, accuser, j1 } = await deployed();
    await tc.connect(accuser).fileCase(1, 2, ethers.ZeroAddress, 0, "x");
    await expect(tc.connect(j1).acceptCase(1, [3], 1)).to.be.revertedWith("not runner");
  });

  it("anchors event hashes during arguments", async () => {
    const { tc, accuser, runner } = await deployed();
    await tc.connect(accuser).fileCase(1, 2, ethers.ZeroAddress, 0, "ipfs://x");
    await tc.acceptCase(1, [3, 4, 5], 2);
    const h = ethers.keccak256(ethers.toUtf8Bytes("opening statement"));
    await expect(tc.recordEvent(1, h))
      .to.emit(tc, "CaseEvent")
      .withArgs(1, 1, await runner.getAddress(), h);
    expect(await tc.caseSeq(1)).to.equal(1n);
  });

  it("computes majority verdict once threshold met", async () => {
    const { tc, accuser, j1, j2, j3 } = await deployed();
    await tc.connect(accuser).fileCase(1, 2, ethers.ZeroAddress, 0, "x");
    await tc.acceptCase(1, [3, 4, 5], 2);
    await tc.connect(j1).submitRuling(1, true,  ethers.id("op1"));
    await tc.connect(j2).submitRuling(1, false, ethers.id("op2"));
    await tc.connect(j3).submitRuling(1, true,  ethers.id("op3"));
    expect(await tc.caseStatus(1)).to.equal(5n); // Ruled
    expect(await tc.casePrevailing(1)).to.equal(true);
  });

  it("rejects double votes from the same judge", async () => {
    const { tc, accuser, j1 } = await deployed();
    await tc.connect(accuser).fileCase(1, 2, ethers.ZeroAddress, 0, "x");
    await tc.acceptCase(1, [3, 4, 5], 2);
    await tc.connect(j1).submitRuling(1, true, ethers.id("op1"));
    await expect(
      tc.connect(j1).submitRuling(1, true, ethers.id("op2")),
    ).to.be.revertedWith("double vote");
  });

  it("rejects submitRuling from a signer who isn't a panel judge", async () => {
    const { tc, accuser, defendant } = await deployed();
    await tc.connect(accuser).fileCase(1, 2, ethers.ZeroAddress, 0, "x");
    await tc.acceptCase(1, [3, 4, 5], 2);
    await expect(
      tc.connect(defendant).submitRuling(1, true, ethers.id("op")),
    ).to.be.revertedWith("not a judge for this case");
  });

  it("flags escrow disputed when filing with an escrow adapter", async () => {
    const { tc, accuser, runner } = await deployed();
    const escrow = await (await ethers.getContractFactory("EscrowAdapter"))
      .deploy(await tc.getAddress());
    const tok = await (await ethers.getContractFactory("MockERC20")).deploy("U", "U", 6);
    await tok.mint(await accuser.getAddress(), 1000n);
    await tok.connect(accuser).approve(await escrow.getAddress(), 100n);
    await escrow.connect(accuser).open(
      await runner.getAddress(), // counterparty doesn't matter for this test
      await tok.getAddress(),
      100n,
    );
    await expect(
      tc.connect(accuser).fileCase(1, 2, await escrow.getAddress(), 1, "x"),
    ).to.emit(escrow, "EscrowDisputed").withArgs(1);
  });
});
