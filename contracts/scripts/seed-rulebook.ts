// Uploads agents/enclave/rulebook/unidroit-v1.json to 0G Storage and
// deploys RuleBookGovernor with the resulting rootHash as baseRoot.
//
// Pre-req: a usable 0G storage env (INDEXER_RPC, RPC_URL). Falls back to
// hashing the file with keccak256 in "memory" mode for local Hardhat,
// since the Hardhat network has no 0G indexer.
import { ethers } from "hardhat";
import * as fs from "node:fs";
import * as path from "node:path";

async function main() {
  const [deployer] = await ethers.getSigners();
  const file = path.resolve(__dirname, "../../agents/enclave/rulebook/unidroit-v1.json");
  const bytes = fs.readFileSync(file);

  let baseRoot: string;
  let baseUrl: string;

  if (process.env.RULEBOOK_BACKEND === "0g") {
    const { Indexer, MemData } = await import("@0glabs/0g-ts-sdk");
    const indexer = new Indexer(process.env.INDEXER_RPC ?? "https://indexer-storage-testnet-turbo.0g.ai");
    const file0g = new (MemData as any)(Array.from(bytes));
    const [res, err] = await (indexer as any).upload(
      file0g, process.env.RPC_URL ?? "https://evmrpc-testnet.0g.ai", deployer
    );
    if (err) throw err;
    baseRoot = res.rootHash;
    baseUrl  = `https://storagescan-galileo.0g.ai/tx/${res.txHash}`;
    console.log("0G base rootHash:", baseRoot);
  } else {
    baseRoot = ethers.keccak256(bytes);
    baseUrl  = "memory:unidroit-v1";
    console.log("memory base hash:", baseRoot);
  }

  const G = await ethers.deployContract("RuleBookGovernor", [baseRoot, baseUrl]);
  await G.waitForDeployment();
  const addr = await G.getAddress();
  console.log("RuleBookGovernor:", addr);

  const out = {
    address: addr,
    baseRoot,
    baseUrl,
    seededAt: new Date().toISOString(),
  };
  const dst = path.resolve(__dirname, "../../docs/rulebook.json");
  fs.writeFileSync(dst, JSON.stringify(out, null, 2));
  console.log("wrote", dst);
}

main().catch((e) => { console.error(e); process.exit(1); });
