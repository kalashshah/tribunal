import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const dep = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../docs/deployment.json"), "utf8"));
  const regAddr = dep.AgentRegistry as string;
  if (!regAddr) throw new Error("AgentRegistry missing in deployment.json");

  const [signer] = await ethers.getSigners();
  console.log("Signer (must be owner):", await signer.getAddress());
  console.log("Registry:", regAddr);

  const reg = await ethers.getContractAt("AgentRegistry", regAddr, signer);

  function envList(key: string): string[] {
    return (process.env[key] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^0x[0-9a-fA-F]{40}$/.test(s));
  }

  const judgeAddrs  = envList("JUDGE_ADDRESSES");
  const lawyerAddrs = envList("LAWYER_ADDRESSES");

  if (judgeAddrs.length === 0 && lawyerAddrs.length === 0) {
    throw new Error("Set JUDGE_ADDRESSES and/or LAWYER_ADDRESSES (comma-separated)");
  }

  for (const a of judgeAddrs) {
    const tx = await reg.admitJudge(a);
    await tx.wait();
    console.log("admitted judge:", a);
  }
  for (const a of lawyerAddrs) {
    const tx = await reg.admitLawyer(a);
    await tx.wait();
    console.log("admitted lawyer:", a);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
