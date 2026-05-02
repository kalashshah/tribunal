import { expect } from "chai";
import { ethers } from "hardhat";

describe("RuleBookGovernor", () => {
  async function deployed() {
    const [deployer, a, b, c] = await ethers.getSigners();
    const RB = await (await ethers.getContractFactory("RuleBook"))
      .deploy(await deployer.getAddress());
    const G = await (await ethers.getContractFactory("RuleBookGovernor"))
      .deploy(await RB.getAddress());
    await RB.transferGovernor(await G.getAddress());
    return { RB, G, deployer, a, b, c };
  }

  it("constructs with the linked RuleBook + quorum 2", async () => {
    const { G, RB } = await deployed();
    expect(await G.ruleBook()).to.equal(await RB.getAddress());
    expect(await G.quorum()).to.equal(2);
    expect(await G.proposalCount()).to.equal(0);
  });

  it("rejects construction with zero ruleBook", async () => {
    await expect(
      (await ethers.getContractFactory("RuleBookGovernor")).deploy(ethers.ZeroAddress),
    ).to.be.revertedWith("zero ruleBook");
  });

  it("accepts a proposal from any address", async () => {
    const { G, a } = await deployed();
    const node = ethers.id("chapter-9-1.rulebook.tribunal.eth");
    await expect(G.connect(a).propose("Add Art 9.1", "9.1", node, "9.1"))
      .to.emit(G, "Proposed").withArgs(0, await a.getAddress(), "Add Art 9.1", "9.1", node);
    expect(await G.proposalCount()).to.equal(1);
    const p = await G.proposalAt(0);
    expect(p.articleId).to.equal("9.1");
    expect(p.ensNode).to.equal(node);
    expect(p.chapter).to.equal("9.1");
  });

  it("rejects proposing an articleId already in the rulebook", async () => {
    const { G, RB, a, b } = await deployed();
    const node = ethers.id("chapter-1-7.rulebook.tribunal.eth");
    await G.connect(a).propose("Add Art 1.7", "1.7", node, "1");
    await G.connect(a).vote(0, true);
    await G.connect(b).vote(0, true);
    await G.execute(0);
    expect(await RB.exists("1.7")).to.equal(true);
    await expect(G.connect(a).propose("Re-add Art 1.7", "1.7", node, "1"))
      .to.be.revertedWith("article already in rulebook");
  });

  it("counts each address once per proposal and rejects post-execute votes", async () => {
    const { G, a, b, c } = await deployed();
    const node = ethers.id("chapter-2-1-1.rulebook.tribunal.eth");
    await G.connect(a).propose("Add Art 2.1.1", "2.1.1", node, "2.1");
    await expect(G.connect(b).vote(0, true)).to.emit(G, "Voted");
    await expect(G.connect(b).vote(0, true)).to.be.revertedWith("already voted");
    await G.connect(c).vote(0, true);
    await G.execute(0);
    const [,,,, d] = await ethers.getSigners();
    await expect(G.connect(d).vote(0, true)).to.be.revertedWith("already executed");
  });

  it("execute calls RuleBook.addArticle and emits Executed", async () => {
    const { G, RB, a, b } = await deployed();
    const node = ethers.id("chapter-7-4-2.rulebook.tribunal.eth");
    await G.connect(a).propose("Add Art 7.4.2", "7.4.2", node, "7.4");
    await G.connect(a).vote(0, true);
    await G.connect(b).vote(0, true);
    await expect(G.execute(0))
      .to.emit(G, "Executed").withArgs(0, "7.4.2", node)
      .and.to.emit(RB, "ArticleAdded").withArgs(0, "7.4.2", node, "7.4");
    expect(await RB.articleCount()).to.equal(1);
    const a0 = await RB.articleAt(0);
    expect(a0.articleId).to.equal("7.4.2");
    expect(a0.ensNode).to.equal(node);
  });

  it("rejects execute below quorum + double execute", async () => {
    const { G, a, b } = await deployed();
    const node = ethers.id("chapter-1-7.rulebook.tribunal.eth");
    await G.connect(a).propose("t", "1.7", node, "1");
    await G.connect(a).vote(0, true);
    await expect(G.execute(0)).to.be.revertedWith("quorum not met");
    await G.connect(b).vote(0, true);
    await G.execute(0);
    await expect(G.execute(0)).to.be.revertedWith("already executed");
  });

  it("rejects empty articleId or zero ensNode at propose", async () => {
    const { G, a } = await deployed();
    await expect(G.connect(a).propose("t", "", ethers.id("x"), "1"))
      .to.be.revertedWith("empty articleId");
    await expect(G.connect(a).propose("t", "1.7", ethers.ZeroHash, "1"))
      .to.be.revertedWith("zero ensNode");
  });
});
