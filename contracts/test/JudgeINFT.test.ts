import { expect } from "chai";
import { ethers } from "hardhat";

describe("JudgeINFT", () => {
  async function deployed() {
    const [owner, writer, other] = await ethers.getSigners();
    const j = await (await ethers.getContractFactory("JudgeINFT"))
      .deploy("Tribunal Judges", "JUDGE", await writer.getAddress());
    return { j, owner, writer, other };
  }

  it("mints a judge with metadata root and exposes views", async () => {
    const { j, owner } = await deployed();
    const root = ethers.id("encryptedPersona-v1");
    await expect(j.mint(await owner.getAddress(), root, "ipfs://encrypted/0xabc"))
      .to.emit(j, "MetadataRootUpdated").withArgs(1, root);
    expect(await j.ownerOf(1)).to.equal(await owner.getAddress());
    expect(await j.metadataRoot(1)).to.equal(root);
    expect(await j.metadataUri(1)).to.equal("ipfs://encrypted/0xabc");
  });

  it("appends ruling memory when called by the owner", async () => {
    const { j, owner } = await deployed();
    await j.mint(await owner.getAddress(), ethers.id("p"), "u");
    const h = ethers.id("case-7-ruling");
    await expect(j.connect(owner).appendRulingMemory(1, h))
      .to.emit(j, "RulingMemoryAppended").withArgs(1, h);
    expect(await j.rulingHistory(1)).to.deep.equal([h]);
  });

  it("appends ruling memory when called by the memoryWriter", async () => {
    const { j, owner, writer } = await deployed();
    await j.mint(await owner.getAddress(), ethers.id("p"), "u");
    const h = ethers.id("case-9-ruling");
    await expect(j.connect(writer).appendRulingMemory(1, h))
      .to.emit(j, "RulingMemoryAppended").withArgs(1, h);
    expect(await j.rulingHistory(1)).to.deep.equal([h]);
  });

  it("rejects appendRulingMemory from random callers", async () => {
    const { j, owner, other } = await deployed();
    await j.mint(await owner.getAddress(), ethers.id("p"), "u");
    await expect(
      j.connect(other).appendRulingMemory(1, ethers.id("x")),
    ).to.be.revertedWith("not authorised");
  });

  it("rotates root when called by owner", async () => {
    const { j, owner, other } = await deployed();
    await j.mint(await owner.getAddress(), ethers.id("v1"), "u1");
    await expect(j.connect(other).rotateRoot(1, ethers.id("v2"), "u2"))
      .to.be.revertedWith("not owner");
    await expect(j.connect(owner).rotateRoot(1, ethers.id("v2"), "u2"))
      .to.emit(j, "MetadataRootUpdated").withArgs(1, ethers.id("v2"));
    expect(await j.metadataRoot(1)).to.equal(ethers.id("v2"));
    expect(await j.metadataUri(1)).to.equal("u2");
  });
});
