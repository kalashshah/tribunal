// Deploys RuleBook + RuleBookGovernor in isolation, leaving other Tribunal
// contracts untouched. Useful when you want to add the rulebook layer to
// an existing 0G Galileo deployment without redeploying every contract.
//
// Run:
//   cd contracts && npx hardhat run scripts/deploy-rulebook.ts --network ogTestnet

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", await deployer.getAddress());
  console.log("Network chainId:", (await ethers.provider.getNetwork()).chainId.toString());

  const RB = await ethers.deployContract("RuleBook", [await deployer.getAddress()]);
  await RB.waitForDeployment();
  const ruleBookAddr = await RB.getAddress();
  console.log("RuleBook deployed:", ruleBookAddr);

  const G = await ethers.deployContract("RuleBookGovernor", [ruleBookAddr]);
  await G.waitForDeployment();
  const governorAddr = await G.getAddress();
  console.log("RuleBookGovernor deployed:", governorAddr);

  const out = {
    network: (await ethers.provider.getNetwork()).chainId.toString(),
    deployer: await deployer.getAddress(),
    RuleBook: ruleBookAddr,
    RuleBookGovernor: governorAddr,
    deployedAt: new Date().toISOString(),
  };
  console.log(JSON.stringify(out, null, 2));

  const dst = path.resolve(__dirname, "../../docs/rulebook-deployment.json");
  fs.writeFileSync(dst, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${dst}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
