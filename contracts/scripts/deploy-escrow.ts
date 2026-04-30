import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/// One-off: deploy TribunalEscrow alongside an EXISTING deployment, without
/// touching the rest. Reads docs/deployment.json for TribunalCore and
/// patches the same file in place with the new TribunalEscrow address.
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", await deployer.getAddress());
  console.log("Network chainId:", (await ethers.provider.getNetwork()).chainId.toString());

  const deploymentPath = path.resolve(__dirname, "../../docs/deployment.json");
  const j = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  if (!j.TribunalCore) throw new Error("deployment.json missing TribunalCore");

  if (j.TribunalEscrow && process.env.REDEPLOY_ESCROW !== "1") {
    console.log(`TribunalEscrow already in deployment.json: ${j.TribunalEscrow}. Set REDEPLOY_ESCROW=1 to overwrite.`);
    return;
  }

  const Escrow = await ethers.deployContract("TribunalEscrow", [j.TribunalCore]);
  await Escrow.waitForDeployment();
  const escrowAddr = await Escrow.getAddress();
  console.log("TribunalEscrow deployed:", escrowAddr);

  j.TribunalEscrow = escrowAddr;
  fs.writeFileSync(deploymentPath, JSON.stringify(j, null, 2) + "\n");
  console.log("Patched", deploymentPath);
}

main().catch((e) => { console.error(e); process.exit(1); });
