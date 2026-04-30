import { expect } from "chai";
import { ethers } from "hardhat";

const BASE_FEE = ethers.parseEther("0.01");

async function setup() {
  const [owner, accuser, defendant, j1, j2, j3, lawyer, stranger] =
    await ethers.getSigners();

  const reg = await (await ethers.getContractFactory("AgentRegistry"))
    .connect(owner).deploy();
  const tc = await (await ethers.getContractFactory("TribunalCore"))
    .connect(owner).deploy(await reg.getAddress());

  await reg.connect(owner).admitJudge(await j1.getAddress());
  await reg.connect(owner).admitJudge(await j2.getAddress());
  await reg.connect(owner).admitJudge(await j3.getAddress());
  await reg.connect(owner).admitLawyer(await lawyer.getAddress());

  return { tc, reg, owner, accuser, defendant, j1, j2, j3, lawyer, stranger };
}

describe("TribunalCore", () => {
  it("files a case when value >= BASE_FEE; CaseFiled has accuser address", async () => {
    const { tc, accuser, defendant } = await setup();
    const tx = await tc.connect(accuser).fileCase(
      await defendant.getAddress(), ethers.ZeroAddress, 0, "ipfs://x",
      { value: BASE_FEE },
    );
    const rc = await tx.wait();
    const ev = rc!.logs
      .map((l) => { try { return tc.interface.parseLog(l as any); } catch { return null; } })
      .find((e) => e?.name === "CaseFiled");
    expect(ev!.args.caseId).to.equal(1n);
    expect(ev!.args.accuser).to.equal(await accuser.getAddress());
    expect(ev!.args.defendant).to.equal(await defendant.getAddress());
    expect(ev!.args.fee).to.equal(BASE_FEE);
    expect(await tc.feesAccrued()).to.equal(BASE_FEE);
  });

  it("reverts fileCase when value < BASE_FEE", async () => {
    const { tc, accuser, defendant } = await setup();
    await expect(
      tc.connect(accuser).fileCase(
        await defendant.getAddress(), ethers.ZeroAddress, 0, "x",
        { value: BASE_FEE - 1n },
      ),
    ).to.be.revertedWith("fee");
  });

  it("accepts a panel of judge addresses; transitions to Arguments", async () => {
    const { tc, owner, accuser, defendant, j1, j2, j3 } = await setup();
    await tc.connect(accuser).fileCase(
      await defendant.getAddress(), ethers.ZeroAddress, 0, "x",
      { value: BASE_FEE },
    );
    const judges = [await j1.getAddress(), await j2.getAddress(), await j3.getAddress()];
    await tc.connect(owner).acceptCase(1, judges, 2);
    expect(await tc.caseStatus(1)).to.equal(3n);
    expect(await tc.caseJudges(1)).to.deep.equal(judges);
  });

  it("rejects acceptCase if any panel address lacks Judge role", async () => {
    const { tc, owner, accuser, defendant, j1, stranger } = await setup();
    await tc.connect(accuser).fileCase(
      await defendant.getAddress(), ethers.ZeroAddress, 0, "x",
      { value: BASE_FEE },
    );
    await expect(
      tc.connect(owner).acceptCase(
        1,
        [await j1.getAddress(), await stranger.getAddress()],
        1,
      ),
    ).to.be.revertedWith("not a judge");
  });

  it("submitRuling rejected if signer not on panel", async () => {
    const { tc, owner, accuser, defendant, j1, j2, stranger } = await setup();
    await tc.connect(accuser).fileCase(
      await defendant.getAddress(), ethers.ZeroAddress, 0, "x",
      { value: BASE_FEE },
    );
    await tc.connect(owner).acceptCase(
      1, [await j1.getAddress(), await j2.getAddress()], 2,
    );
    await expect(
      tc.connect(stranger).submitRuling(1, true, ethers.id("op")),
    ).to.be.revertedWith("not a panel judge");
  });

  it("computes majority once threshold met", async () => {
    const { tc, owner, accuser, defendant, j1, j2, j3 } = await setup();
    await tc.connect(accuser).fileCase(
      await defendant.getAddress(), ethers.ZeroAddress, 0, "x",
      { value: BASE_FEE },
    );
    await tc.connect(owner).acceptCase(
      1,
      [await j1.getAddress(), await j2.getAddress(), await j3.getAddress()],
      2,
    );
    await tc.connect(j1).submitRuling(1, true,  ethers.id("a"));
    await tc.connect(j2).submitRuling(1, false, ethers.id("b"));
    await tc.connect(j3).submitRuling(1, true,  ethers.id("c"));
    expect(await tc.caseStatus(1)).to.equal(5n);
    expect(await tc.casePrevailing(1)).to.equal(true);
  });

  it("withdrawFees is onlyOwner and transfers full feesAccrued", async () => {
    const { tc, owner, accuser, defendant, stranger } = await setup();
    await tc.connect(accuser).fileCase(
      await defendant.getAddress(), ethers.ZeroAddress, 0, "x",
      { value: BASE_FEE },
    );
    await expect(
      tc.connect(stranger).withdrawFees(await stranger.getAddress()),
    ).to.be.revertedWithCustomError(tc, "OwnableUnauthorizedAccount");
    const recipient = await stranger.getAddress();
    const before = await ethers.provider.getBalance(recipient);
    await tc.connect(owner).withdrawFees(recipient);
    const after = await ethers.provider.getBalance(recipient);
    expect(after - before).to.equal(BASE_FEE);
    expect(await tc.feesAccrued()).to.equal(0n);
  });
});
