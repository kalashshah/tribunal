import { expect } from "chai";
import { ethers } from "hardhat";

describe("EscrowAdapter", () => {
  async function fixture() {
    const [, alice, bob, tribunal] = await ethers.getSigners();
    const tok = await (await ethers.getContractFactory("MockERC20")).deploy("USDC", "USDC", 6);
    await tok.mint(await alice.getAddress(), 1_000_000n);
    const escrow = await (await ethers.getContractFactory("EscrowAdapter")).deploy(
      await tribunal.getAddress(),
    );
    return { tok, escrow, alice, bob, tribunal };
  }

  it("opens an escrow funded by the depositor", async () => {
    const { tok, escrow, alice, bob } = await fixture();
    await tok.connect(alice).approve(await escrow.getAddress(), 100n);
    await expect(escrow.connect(alice).open(await bob.getAddress(), await tok.getAddress(), 100n))
      .to.emit(escrow, "EscrowOpened");
    expect(await tok.balanceOf(await escrow.getAddress())).to.equal(100n);
  });

  it("only tribunal can flag disputed", async () => {
    const { tok, escrow, alice, bob, tribunal } = await fixture();
    await tok.connect(alice).approve(await escrow.getAddress(), 100n);
    await escrow.connect(alice).open(await bob.getAddress(), await tok.getAddress(), 100n);
    await expect(escrow.connect(alice).flagDisputed(1)).to.be.revertedWith("only tribunal");
    await expect(escrow.connect(tribunal).flagDisputed(1)).to.emit(escrow, "EscrowDisputed");
  });

  it("only tribunal can release on dispute resolution", async () => {
    const { tok, escrow, alice, bob, tribunal } = await fixture();
    await tok.connect(alice).approve(await escrow.getAddress(), 100n);
    await escrow.connect(alice).open(await bob.getAddress(), await tok.getAddress(), 100n);
    await expect(
      escrow.connect(alice).release(1, await alice.getAddress()),
    ).to.be.revertedWith("only tribunal");
    await expect(escrow.connect(tribunal).release(1, await alice.getAddress()))
      .to.emit(escrow, "EscrowReleased");
    expect(await tok.balanceOf(await alice.getAddress())).to.equal(1_000_000n); // refunded
  });

  it("rejects release to a non-party address", async () => {
    const { tok, escrow, alice, bob, tribunal } = await fixture();
    const [, , , , stranger] = await ethers.getSigners();
    await tok.connect(alice).approve(await escrow.getAddress(), 100n);
    await escrow.connect(alice).open(await bob.getAddress(), await tok.getAddress(), 100n);
    await expect(
      escrow.connect(tribunal).release(1, await stranger.getAddress()),
    ).to.be.revertedWith("bad recipient");
  });

  it("rejects double release", async () => {
    const { tok, escrow, alice, bob, tribunal } = await fixture();
    await tok.connect(alice).approve(await escrow.getAddress(), 100n);
    await escrow.connect(alice).open(await bob.getAddress(), await tok.getAddress(), 100n);
    await escrow.connect(tribunal).release(1, await alice.getAddress());
    await expect(
      escrow.connect(tribunal).release(1, await alice.getAddress()),
    ).to.be.revertedWith("bad state");
  });
});
