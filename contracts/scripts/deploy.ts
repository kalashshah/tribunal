import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", await deployer.getAddress());
  console.log("Network chainId:", (await ethers.provider.getNetwork()).chainId.toString());

  const Reg = await ethers.deployContract("AgentRegistry");
  await Reg.waitForDeployment();

  const Tribunal = await ethers.deployContract("TribunalCore", [await Reg.getAddress()]);
  await Tribunal.waitForDeployment();

  const Escrow = await ethers.deployContract("EscrowAdapter", [await Tribunal.getAddress()]);
  await Escrow.waitForDeployment();

  const Verdict = await ethers.deployContract("VerdictLog", [await Tribunal.getAddress()]);
  await Verdict.waitForDeployment();

  // Memory writer = Tribunal contract, so it can append ruling memory after submitRuling.
  const Judges = await ethers.deployContract("JudgeINFT", [
    "Tribunal Judges",
    "JUDGE",
    await Tribunal.getAddress(),
  ]);
  await Judges.waitForDeployment();

  const out = {
    network: (await ethers.provider.getNetwork()).chainId.toString(),
    deployer: await deployer.getAddress(),
    AgentRegistry: await Reg.getAddress(),
    TribunalCore: await Tribunal.getAddress(),
    EscrowAdapter: await Escrow.getAddress(),
    VerdictLog: await Verdict.getAddress(),
    JudgeINFT: await Judges.getAddress(),
  };
  console.log(JSON.stringify(out, null, 2));

  const dst = path.resolve(__dirname, "../../docs/deployment.json");
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${dst}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
