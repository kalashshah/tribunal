import { expect } from "chai";
import { ethers } from "hardhat";

describe("RuleBook", () => {
  async function deployed() {
    const [owner, gov, other] = await ethers.getSigners();
    const RB = await (await ethers.getContractFactory("RuleBook"))
      .deploy(await gov.getAddress());
    return { RB, owner, gov, other };
  }

  it("seeds with the governor at construction", async () => {
    const { RB, gov } = await deployed();
    expect(await RB.governor()).to.equal(await gov.getAddress());
    expect(await RB.articleCount()).to.equal(0);
  });

  it("rejects construction with zero governor", async () => {
    await expect(
      (await ethers.getContractFactory("RuleBook")).deploy(ethers.ZeroAddress),
    ).to.be.revertedWith("zero governor");
  });

  it("appends articles when called by governor", async () => {
    const { RB, gov } = await deployed();
    const node = ethers.id("chapter-7-4-2.rulebook.tribunal.eth");
    await expect(RB.connect(gov).addArticle("7.4.2", node, "7.4"))
      .to.emit(RB, "ArticleAdded").withArgs(0, "7.4.2", node, "7.4");
    expect(await RB.articleCount()).to.equal(1);
    const a = await RB.articleAt(0);
    expect(a.articleId).to.equal("7.4.2");
    expect(a.ensNode).to.equal(node);
    expect(a.chapter).to.equal("7.4");
    expect(await RB.exists("7.4.2")).to.equal(true);
  });

  it("rejects writes from non-governor", async () => {
    const { RB, other } = await deployed();
    await expect(
      RB.connect(other).addArticle("7.4.2", ethers.id("x"), "7.4"),
    ).to.be.revertedWith("only governor");
  });

  it("rejects empty articleId, zero ensNode, and duplicates", async () => {
    const { RB, gov } = await deployed();
    await expect(RB.connect(gov).addArticle("", ethers.id("x"), "7.4"))
      .to.be.revertedWith("empty articleId");
    await expect(RB.connect(gov).addArticle("7.4.2", ethers.ZeroHash, "7.4"))
      .to.be.revertedWith("zero ensNode");
    await RB.connect(gov).addArticle("7.4.2", ethers.id("x"), "7.4");
    await expect(RB.connect(gov).addArticle("7.4.2", ethers.id("y"), "7.4"))
      .to.be.revertedWith("already exists");
  });

  it("getByArticleId returns the stored entry", async () => {
    const { RB, gov } = await deployed();
    const node = ethers.id("chapter-1-7.rulebook.tribunal.eth");
    await RB.connect(gov).addArticle("1.7", node, "1");
    const a = await RB.getByArticleId("1.7");
    expect(a.ensNode).to.equal(node);
  });

  it("getByArticleId reverts on unknown", async () => {
    const { RB } = await deployed();
    await expect(RB.getByArticleId("9.9.9")).to.be.revertedWith("not found");
  });

  it("transferGovernor moves write authority and emits", async () => {
    const { RB, gov, other } = await deployed();
    await expect(RB.connect(gov).transferGovernor(await other.getAddress()))
      .to.emit(RB, "GovernorTransferred").withArgs(await gov.getAddress(), await other.getAddress());
    expect(await RB.governor()).to.equal(await other.getAddress());
    // old governor can no longer write
    await expect(RB.connect(gov).addArticle("1.7", ethers.id("x"), "1"))
      .to.be.revertedWith("only governor");
    // new governor can
    await RB.connect(other).addArticle("1.7", ethers.id("x"), "1");
    expect(await RB.exists("1.7")).to.equal(true);
  });

  it("transferGovernor rejects non-governor + zero target", async () => {
    const { RB, gov, other } = await deployed();
    await expect(RB.connect(other).transferGovernor(await other.getAddress()))
      .to.be.revertedWith("only governor");
    await expect(RB.connect(gov).transferGovernor(ethers.ZeroAddress))
      .to.be.revertedWith("zero new governor");
  });
});
