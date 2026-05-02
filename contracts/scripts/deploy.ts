import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", await deployer.getAddress());
  console.log("Network chainId:", (await ethers.provider.getNetwork()).chainId.toString());

  const Reg = await ethers.deployContract("AgentRegistry");
  await Reg.waitForDeployment();

  // Admit judges and lawyers from env. Empty / missing values are skipped so the
  // script stays usable with a partial setup.
  function envList(key: string): string[] {
    return (process.env[key] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^0x[0-9a-fA-F]{40}$/.test(s));
  }

  const judgeAddrs  = envList("JUDGE_ADDRESSES");
  const lawyerAddrs = envList("LAWYER_ADDRESSES");

  for (const a of judgeAddrs) {
    const tx = await (Reg.connect(deployer) as any).admitJudge(a);
    await tx.wait();
    console.log("admitted judge:", a);
  }
  for (const a of lawyerAddrs) {
    const tx = await (Reg.connect(deployer) as any).admitLawyer(a);
    await tx.wait();
    console.log("admitted lawyer:", a);
  }

  const Tribunal = await ethers.deployContract("TribunalCore", [await Reg.getAddress()]);
  await Tribunal.waitForDeployment();

  const Escrow = await ethers.deployContract("EscrowAdapter", [await Tribunal.getAddress()]);
  await Escrow.waitForDeployment();

  const TribunalEscrow = await ethers.deployContract("TribunalEscrow", [await Tribunal.getAddress()]);
  await TribunalEscrow.waitForDeployment();

  const Verdict = await ethers.deployContract("VerdictLog", [await Tribunal.getAddress()]);
  await Verdict.waitForDeployment();

  // Memory writer = Tribunal contract, so it can append ruling memory after submitRuling.
  const Judges = await ethers.deployContract("JudgeINFT", [
    "Tribunal Judges",
    "JUDGE",
    await Tribunal.getAddress(),
  ]);
  await Judges.waitForDeployment();

  // Seed rulebook from local file. On local Hardhat, hash via keccak; in
  // 0G mode the operator can re-run scripts/seed-rulebook.ts standalone
  // to swap to a 0G-backed root.
  const rulebookFile = path.resolve(__dirname, "../../agents/enclave/rulebook/unidroit-v1.json");
  const rulebookBytes = fs.readFileSync(rulebookFile);
  const baseRoot = ethers.keccak256(rulebookBytes);
  const Governor = await ethers.deployContract("RuleBookGovernor", [baseRoot, "memory:unidroit-v1"]);
  await Governor.waitForDeployment();

  const out = {
    network: (await ethers.provider.getNetwork()).chainId.toString(),
    deployer: await deployer.getAddress(),
    AgentRegistry: await Reg.getAddress(),
    TribunalCore: await Tribunal.getAddress(),
    EscrowAdapter: await Escrow.getAddress(),
    TribunalEscrow: await TribunalEscrow.getAddress(),
    VerdictLog: await Verdict.getAddress(),
    JudgeINFT: await Judges.getAddress(),
    RuleBookGovernor: await Governor.getAddress(),
  };
  console.log(JSON.stringify(out, null, 2));

  const dst = path.resolve(__dirname, "../../docs/deployment.json");
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${dst}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
