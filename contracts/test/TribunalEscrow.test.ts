import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const ONE_OG = ethers.parseEther("1");
const TRIBUNAL_SETTLED = 6;

const PROPOSED = 0, ACCEPTED = 1, FUNDED = 2, CLAIMED = 3, RELEASED = 4, DISPUTED = 5, SETTLED = 6, REVOKED = 7;

async function fixture() {
  const [deployer, payer, payee, other] = await ethers.getSigners();
  const Mock = await ethers.deployContract("TribunalCoreReaderMock");
  await Mock.waitForDeployment();
  const Escrow = await ethers.deployContract("TribunalEscrow", [await Mock.getAddress()]);
  await Escrow.waitForDeployment();
  return { deployer, payer, payee, other, mock: Mock, escrow: Escrow };
}

async function proposed(byPayee = true) {
  const ctx = await fixture();
  const { escrow, payer, payee } = ctx;
  const deadline = (await time.latest()) + 60 * 60;
  const proposer = byPayee ? payee : payer;
  await (await escrow.connect(proposer).proposeAgreement(payer.address, payee.address, ONE_OG, deadline, "delivery terms")).wait();
  return { ...ctx, deadline };
}

async function accepted(byPayee = true) {
  const ctx = await proposed(byPayee);
  const { escrow, payer, payee } = ctx;
  // The OTHER party accepts.
  const acceptor = byPayee ? payer : payee;
  await (await escrow.connect(acceptor).acceptAgreement(1)).wait();
  return ctx;
}

async function funded(byPayee = true) {
  const ctx = await accepted(byPayee);
  const { escrow, payer } = ctx;
  await (await escrow.connect(payer).fundAgreement(1, { value: ONE_OG })).wait();
  return ctx;
}

describe("TribunalEscrow — propose / accept / revoke", () => {
  it("payee proposes; payer accepts; payer funds — happy path through Funded", async () => {
    const { escrow, payer, payee } = await fixture();
    const deadline = (await time.latest()) + 60 * 60;
    await expect(escrow.connect(payee).proposeAgreement(payer.address, payee.address, ONE_OG, deadline, "delivery"))
      .to.emit(escrow, "AgreementProposed").withArgs(1, payee.address, payer.address, payee.address, ONE_OG, deadline, "delivery");
    let view = await escrow.getAgreement(1);
    expect(view[2]).to.equal(payee.address);  // proposer
    expect(view[6]).to.equal(PROPOSED);        // status

    await expect(escrow.connect(payer).acceptAgreement(1))
      .to.emit(escrow, "AgreementAccepted").withArgs(1, payer.address);
    view = await escrow.getAgreement(1);
    expect(view[6]).to.equal(ACCEPTED);

    await (await escrow.connect(payer).fundAgreement(1, { value: ONE_OG })).wait();
    view = await escrow.getAgreement(1);
    expect(view[6]).to.equal(FUNDED);
  });

  it("payer proposes; payee accepts", async () => {
    const ctx = await accepted(false);
    const view = await ctx.escrow.getAgreement(1);
    expect(view[2]).to.equal(ctx.payer.address);
    expect(view[6]).to.equal(ACCEPTED);
  });

  it("proposeAgreement reverts when caller is not a party", async () => {
    const { escrow, payer, payee, other } = await fixture();
    const deadline = (await time.latest()) + 60 * 60;
    await expect(escrow.connect(other).proposeAgreement(payer.address, payee.address, ONE_OG, deadline, ""))
      .to.be.revertedWith("proposer must be a party");
  });

  it("acceptAgreement reverts when proposer tries to self-accept", async () => {
    const ctx = await proposed(true);
    await expect(ctx.escrow.connect(ctx.payee).acceptAgreement(1)).to.be.revertedWith("proposer cannot accept");
  });

  it("acceptAgreement reverts when caller is not a party", async () => {
    const ctx = await proposed(true);
    await expect(ctx.escrow.connect(ctx.other).acceptAgreement(1)).to.be.revertedWith("only party");
  });

  it("acceptAgreement reverts when not in Proposed state", async () => {
    const ctx = await accepted(true);
    await expect(ctx.escrow.connect(ctx.payer).acceptAgreement(1)).to.be.revertedWith("bad state");
  });

  it("revokeProposal: only proposer, only while Proposed", async () => {
    const ctx = await proposed(true);
    await expect(ctx.escrow.connect(ctx.payer).revokeProposal(1)).to.be.revertedWith("only proposer");
    await (await ctx.escrow.connect(ctx.payee).revokeProposal(1)).wait();
    const view = await ctx.escrow.getAgreement(1);
    expect(view[6]).to.equal(REVOKED);
    // After revoke, can't accept or fund.
    await expect(ctx.escrow.connect(ctx.payer).acceptAgreement(1)).to.be.revertedWith("bad state");
  });

  it("fundAgreement reverts when not Accepted (still Proposed)", async () => {
    const ctx = await proposed(true);
    await expect(ctx.escrow.connect(ctx.payer).fundAgreement(1, { value: ONE_OG })).to.be.revertedWith("bad state");
  });
});

describe("TribunalEscrow — happy paths after Funded", () => {
  it("releasePayment pays payee", async () => {
    const ctx = await funded(true);
    const before = await ethers.provider.getBalance(ctx.payee.address);
    await (await ctx.escrow.connect(ctx.payer).releasePayment(1)).wait();
    const after = await ethers.provider.getBalance(ctx.payee.address);
    expect(after - before).to.equal(ONE_OG);
    const view = await ctx.escrow.getAgreement(1);
    expect(view[6]).to.equal(RELEASED);
  });

  it("claimAfterDeadline + finalizeClaim pays payee after grace", async () => {
    const ctx = await funded(true);
    await time.increaseTo(ctx.deadline + 1);
    await (await ctx.escrow.connect(ctx.payee).claimAfterDeadline(1)).wait();
    expect((await ctx.escrow.getAgreement(1))[6]).to.equal(CLAIMED);
    await expect(ctx.escrow.finalizeClaim(1)).to.be.revertedWith("in grace");
    await time.increase(24 * 60 * 60 + 1);
    const before = await ethers.provider.getBalance(ctx.payee.address);
    await (await ctx.escrow.finalizeClaim(1)).wait();
    const after = await ethers.provider.getBalance(ctx.payee.address);
    expect(after - before).to.equal(ONE_OG);
  });
});

describe("TribunalEscrow — dispute + verdict payout matrix", () => {
  async function disputed(accuserIsPayee: boolean) {
    const ctx = await funded(true);
    const { escrow, mock } = ctx;
    const mockAddr = await mock.getAddress();
    await ethers.provider.send("hardhat_impersonateAccount", [mockAddr]);
    await ethers.provider.send("hardhat_setBalance", [mockAddr, "0xDE0B6B3A7640000"]);
    const mockSigner = await ethers.getSigner(mockAddr);
    await (await escrow.connect(mockSigner).flagDisputed(1)).wait();
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [mockAddr]);
    return ctx;
  }

  it("accuser=payee, prevailing=true → pay payee", async () => {
    const { escrow, mock, payee, other } = await disputed(true);
    await (await mock.setCase(42, TRIBUNAL_SETTLED, true, payee.address)).wait();
    const before = await ethers.provider.getBalance(payee.address);
    await (await escrow.connect(other).settleByTribunal(1, 42)).wait();
    const after = await ethers.provider.getBalance(payee.address);
    expect(after - before).to.equal(ONE_OG);
  });

  it("accuser=payee, prevailing=false → refund payer", async () => {
    const { escrow, mock, payer, payee, other } = await disputed(true);
    await (await mock.setCase(42, TRIBUNAL_SETTLED, false, payee.address)).wait();
    const before = await ethers.provider.getBalance(payer.address);
    await (await escrow.connect(other).settleByTribunal(1, 42)).wait();
    const after = await ethers.provider.getBalance(payer.address);
    expect(after - before).to.equal(ONE_OG);
  });

  it("accuser=payer, prevailing=true → refund payer", async () => {
    const { escrow, mock, payer, other } = await disputed(false);
    await (await mock.setCase(42, TRIBUNAL_SETTLED, true, payer.address)).wait();
    const before = await ethers.provider.getBalance(payer.address);
    await (await escrow.connect(other).settleByTribunal(1, 42)).wait();
    const after = await ethers.provider.getBalance(payer.address);
    expect(after - before).to.equal(ONE_OG);
  });

  it("accuser=payer, prevailing=false → pay payee", async () => {
    const { escrow, mock, payer, payee, other } = await disputed(false);
    await (await mock.setCase(42, TRIBUNAL_SETTLED, false, payer.address)).wait();
    const before = await ethers.provider.getBalance(payee.address);
    await (await escrow.connect(other).settleByTribunal(1, 42)).wait();
    const after = await ethers.provider.getBalance(payee.address);
    expect(after - before).to.equal(ONE_OG);
  });

  it("settleByTribunal reverts when case not Settled", async () => {
    const { escrow, mock, payee, other } = await disputed(true);
    await (await mock.setCase(42, 5, true, payee.address)).wait();
    await expect(escrow.connect(other).settleByTribunal(1, 42)).to.be.revertedWith("case not settled");
  });

  it("settleByTribunal reverts when accuser not a party", async () => {
    const { escrow, mock, other } = await disputed(true);
    await (await mock.setCase(42, TRIBUNAL_SETTLED, true, other.address)).wait();
    await expect(escrow.connect(other).settleByTribunal(1, 42)).to.be.revertedWith("accuser not party");
  });
});

describe("TribunalEscrow — reverts (basics)", () => {
  it("proposeAgreement: zero party / same party / zero amount / past deadline", async () => {
    const { escrow, payer, payee } = await fixture();
    const future = (await time.latest()) + 60;
    await expect(escrow.connect(payer).proposeAgreement(ethers.ZeroAddress, payee.address, ONE_OG, future, "")).to.be.revertedWith("zero party");
    await expect(escrow.connect(payer).proposeAgreement(payer.address, payer.address, ONE_OG, future, "")).to.be.revertedWith("same party");
    await expect(escrow.connect(payer).proposeAgreement(payer.address, payee.address, 0, future, "")).to.be.revertedWith("zero amount");
    await expect(escrow.connect(payer).proposeAgreement(payer.address, payee.address, ONE_OG, await time.latest(), "")).to.be.revertedWith("past deadline");
  });

  it("releasePayment: only payer", async () => {
    const ctx = await funded(true);
    await expect(ctx.escrow.connect(ctx.payee).releasePayment(1)).to.be.revertedWith("only payer");
  });

  it("claimAfterDeadline: only payee / before deadline", async () => {
    const ctx = await funded(true);
    await expect(ctx.escrow.connect(ctx.payer).claimAfterDeadline(1)).to.be.revertedWith("only payee");
    await expect(ctx.escrow.connect(ctx.payee).claimAfterDeadline(1)).to.be.revertedWith("before deadline");
  });

  it("flagDisputed: only tribunal", async () => {
    const ctx = await funded(true);
    await expect(ctx.escrow.connect(ctx.other).flagDisputed(1)).to.be.revertedWith("only tribunal");
  });
});
