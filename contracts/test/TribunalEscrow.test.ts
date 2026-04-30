import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const ONE_OG = ethers.parseEther("1");
const SETTLED = 6;

async function fixture() {
  const [deployer, payer, payee, other] = await ethers.getSigners();
  const Mock = await ethers.deployContract("TribunalCoreReaderMock");
  await Mock.waitForDeployment();
  const Escrow = await ethers.deployContract("TribunalEscrow", [await Mock.getAddress()]);
  await Escrow.waitForDeployment();
  return { deployer, payer, payee, other, mock: Mock, escrow: Escrow };
}

async function createFunded(): Promise<any> {
  const ctx = await fixture();
  const { escrow, payer, payee } = ctx;
  const deadline = (await time.latest()) + 60 * 60; // 1 hour
  await (await escrow.connect(payer).createAgreement(payer.address, payee.address, ONE_OG, deadline, "terms")).wait();
  await (await escrow.connect(payer).fundAgreement(1, { value: ONE_OG })).wait();
  return { ...ctx, deadline };
}

describe("TribunalEscrow — happy paths", () => {
  it("createAgreement stores fields, increments id, emits AgreementCreated", async () => {
    const { escrow, payer, payee } = await fixture();
    const deadline = (await time.latest()) + 60 * 60;
    const tx = await escrow.connect(payer).createAgreement(payer.address, payee.address, ONE_OG, deadline, "Delivery of widgets");
    await expect(tx)
      .to.emit(escrow, "AgreementCreated")
      .withArgs(1, payer.address, payee.address, ONE_OG, BigInt(deadline), "Delivery of widgets");
    const [p, q, amt, dl, claimedAt, status, terms] = await escrow.getAgreement(1);
    expect(p).to.equal(payer.address);
    expect(q).to.equal(payee.address);
    expect(amt).to.equal(ONE_OG);
    expect(dl).to.equal(BigInt(deadline));
    expect(claimedAt).to.equal(0n);
    expect(status).to.equal(0); // Draft
    expect(terms).to.equal("Delivery of widgets");
    expect(await escrow.nextId()).to.equal(2n);
  });

  it("fundAgreement transitions Draft → Funded and locks msg.value", async () => {
    const { escrow } = await createFunded();
    const [, , , , , status] = await escrow.getAgreement(1);
    expect(status).to.equal(1); // Funded
    expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(ONE_OG);
  });

  it("releasePayment pays payee and marks Released", async () => {
    const { escrow, payer, payee } = await createFunded();
    const before = await ethers.provider.getBalance(payee.address);
    await (await escrow.connect(payer).releasePayment(1)).wait();
    const after = await ethers.provider.getBalance(payee.address);
    expect(after - before).to.equal(ONE_OG);
    const [, , , , , status] = await escrow.getAgreement(1);
    expect(status).to.equal(3); // Released
  });

  it("claimAfterDeadline + finalizeClaim pays payee after grace window", async () => {
    const { escrow, payee, deadline } = await createFunded();
    await time.increaseTo(deadline + 1);
    await (await escrow.connect(payee).claimAfterDeadline(1)).wait();
    const [, , , , claimedAt, statusAfterClaim] = await escrow.getAgreement(1);
    expect(statusAfterClaim).to.equal(2); // Claimed
    expect(claimedAt).to.be.gt(0n);
    // Grace not yet elapsed
    await expect(escrow.finalizeClaim(1)).to.be.revertedWith("in grace");
    await time.increase(24 * 60 * 60 + 1);
    const before = await ethers.provider.getBalance(payee.address);
    await (await escrow.finalizeClaim(1)).wait();
    const after = await ethers.provider.getBalance(payee.address);
    expect(after - before).to.equal(ONE_OG);
  });
});

describe("TribunalEscrow — dispute + verdict payout matrix", () => {
  async function disputed(accuserIsPayee: boolean) {
    const ctx = await createFunded();
    const { escrow, mock, payee, payer } = ctx;
    // simulate TribunalCore by impersonating the mock contract address
    const mockAddr = await mock.getAddress();
    await ethers.provider.send("hardhat_impersonateAccount", [mockAddr]);
    await ethers.provider.send("hardhat_setBalance", [mockAddr, "0xDE0B6B3A7640000"]); // 1 ETH for gas
    const mockSigner = await ethers.getSigner(mockAddr);
    await (await escrow.connect(mockSigner).flagDisputed(1)).wait();
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [mockAddr]);
    const accuser = accuserIsPayee ? payee : payer;
    return { ...ctx, accuser };
  }

  it("accuser=payee, prevailing=true → pay payee", async () => {
    const { escrow, mock, payer, payee, other } = await disputed(true);
    await (await mock.setCase(42, SETTLED, true, payee.address)).wait();
    const before = await ethers.provider.getBalance(payee.address);
    await (await escrow.connect(other).settleByTribunal(1, 42)).wait();
    const after = await ethers.provider.getBalance(payee.address);
    expect(after - before).to.equal(ONE_OG);
  });

  it("accuser=payee, prevailing=false → refund payer", async () => {
    const { escrow, mock, payer, payee, other } = await disputed(true);
    await (await mock.setCase(42, SETTLED, false, payee.address)).wait();
    const before = await ethers.provider.getBalance(payer.address);
    await (await escrow.connect(other).settleByTribunal(1, 42)).wait();
    const after = await ethers.provider.getBalance(payer.address);
    expect(after - before).to.equal(ONE_OG);
  });

  it("accuser=payer, prevailing=true → refund payer", async () => {
    const { escrow, mock, payer, payee, other } = await disputed(false);
    await (await mock.setCase(42, SETTLED, true, payer.address)).wait();
    const before = await ethers.provider.getBalance(payer.address);
    await (await escrow.connect(other).settleByTribunal(1, 42)).wait();
    const after = await ethers.provider.getBalance(payer.address);
    expect(after - before).to.equal(ONE_OG);
  });

  it("accuser=payer, prevailing=false → pay payee", async () => {
    const { escrow, mock, payer, payee, other } = await disputed(false);
    await (await mock.setCase(42, SETTLED, false, payer.address)).wait();
    const before = await ethers.provider.getBalance(payee.address);
    await (await escrow.connect(other).settleByTribunal(1, 42)).wait();
    const after = await ethers.provider.getBalance(payee.address);
    expect(after - before).to.equal(ONE_OG);
  });

  it("settleByTribunal reverts when case not Settled", async () => {
    const { escrow, mock, payee, other } = await disputed(true);
    await (await mock.setCase(42, 5, true, payee.address)).wait(); // Ruled, not Settled
    await expect(escrow.connect(other).settleByTribunal(1, 42)).to.be.revertedWith("case not settled");
  });

  it("settleByTribunal reverts when accuser not a party", async () => {
    const { escrow, mock, other } = await disputed(true);
    await (await mock.setCase(42, SETTLED, true, other.address)).wait();
    await expect(escrow.connect(other).settleByTribunal(1, 42)).to.be.revertedWith("accuser not party");
  });
});

describe("TribunalEscrow — reverts", () => {
  it("createAgreement: zero party / same party / zero amount / past deadline", async () => {
    const { escrow, payer, payee } = await fixture();
    const future = (await time.latest()) + 60;
    await expect(escrow.createAgreement(ethers.ZeroAddress, payee.address, ONE_OG, future, "")).to.be.revertedWith("zero party");
    await expect(escrow.createAgreement(payer.address, payer.address, ONE_OG, future, "")).to.be.revertedWith("same party");
    await expect(escrow.createAgreement(payer.address, payee.address, 0, future, "")).to.be.revertedWith("zero amount");
    await expect(escrow.createAgreement(payer.address, payee.address, ONE_OG, await time.latest(), "")).to.be.revertedWith("past deadline");
  });

  it("fundAgreement: only payer / wrong value / bad state", async () => {
    const { escrow, payer, payee } = await fixture();
    const dl = (await time.latest()) + 60;
    await (await escrow.createAgreement(payer.address, payee.address, ONE_OG, dl, "")).wait();
    await expect(escrow.connect(payee).fundAgreement(1, { value: ONE_OG })).to.be.revertedWith("only payer");
    await expect(escrow.connect(payer).fundAgreement(1, { value: 1n })).to.be.revertedWith("wrong value");
    await (await escrow.connect(payer).fundAgreement(1, { value: ONE_OG })).wait();
    await expect(escrow.connect(payer).fundAgreement(1, { value: ONE_OG })).to.be.revertedWith("bad state");
  });

  it("releasePayment: only payer", async () => {
    const { escrow, payee } = await createFunded();
    await expect(escrow.connect(payee).releasePayment(1)).to.be.revertedWith("only payer");
  });

  it("claimAfterDeadline: only payee / before deadline", async () => {
    const { escrow, payer, payee } = await createFunded();
    await expect(escrow.connect(payer).claimAfterDeadline(1)).to.be.revertedWith("only payee");
    await expect(escrow.connect(payee).claimAfterDeadline(1)).to.be.revertedWith("before deadline");
  });

  it("flagDisputed: only tribunal", async () => {
    const { escrow, other } = await createFunded();
    await expect(escrow.connect(other).flagDisputed(1)).to.be.revertedWith("only tribunal");
  });
});
