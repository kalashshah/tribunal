import { expect } from "chai";
import { ethers } from "hardhat";

describe("RuleBookGovernor", () => {
  async function deployed() {
    const [a, b, c] = await ethers.getSigners();
    const baseRoot = ethers.id("rulebook-base-v1");
    const G = await (await ethers.getContractFactory("RuleBookGovernor"))
      .deploy(baseRoot, "ipfs://demo/base");
    return { G, baseRoot, a, b, c };
  }

  it("exposes the seeded base root and zero amendments", async () => {
    const { G, baseRoot } = await deployed();
    expect(await G.baseRoot()).to.equal(baseRoot);
    expect(await G.amendmentCount()).to.equal(0);
  });

  it("accepts a proposal from any address", async () => {
    const { G, b } = await deployed();
    const cidRoot = ethers.id("amendment-1");
    await expect(G.connect(b).propose("AML carve-out", cidRoot, "0g://amend1"))
      .to.emit(G, "Proposed").withArgs(0, await b.getAddress(), "AML carve-out", cidRoot);
    expect(await G.proposalCount()).to.equal(1);
  });

  it("counts each address once per proposal", async () => {
    const { G, a, b } = await deployed();
    await G.connect(a).propose("t", ethers.id("x"), "u");
    await expect(G.connect(b).vote(0, true)).to.emit(G, "Voted").withArgs(0, await b.getAddress(), true);
    await expect(G.connect(b).vote(0, true)).to.be.revertedWith("already voted");
  });

  it("executes when yes>=quorum and appends amendment + rotates current root", async () => {
    const { G, a, b } = await deployed();
    const cidRoot = ethers.id("amend-x");
    await G.connect(a).propose("Add Art 99", cidRoot, "0g://x");
    await G.connect(a).vote(0, true);
    await G.connect(b).vote(0, true); // quorum = 2 in tests via constructor variant? See Task 3.
    await expect(G.connect(a).execute(0)).to.emit(G, "Executed").withArgs(0, cidRoot);
    expect(await G.amendmentCount()).to.equal(1);
    const am = await G.amendmentAt(0);
    expect(am.cidRoot).to.equal(cidRoot);
    const expected = ethers.solidityPackedKeccak256(
      ["bytes32", "bytes32"],
      [await G.baseRoot(), cidRoot],
    );
    expect(await G.currentManifestHash()).to.equal(expected);
  });

  it("rejects execute below quorum", async () => {
    const { G, a } = await deployed();
    await G.connect(a).propose("t", ethers.id("y"), "u");
    await G.connect(a).vote(0, true);
    await expect(G.connect(a).execute(0)).to.be.revertedWith("quorum not met");
  });

  it("rejects double-execute", async () => {
    const { G, a, b } = await deployed();
    await G.connect(a).propose("t", ethers.id("z"), "u");
    await G.connect(a).vote(0, true);
    await G.connect(b).vote(0, true);
    await G.connect(a).execute(0);
    await expect(G.connect(a).execute(0)).to.be.revertedWith("already executed");
  });
});
