/**
 * End-to-end seed for the Tribunal rulebook.
 *
 *   1. Ensure `rulebook.tribunal.eth` exists on Sepolia (create if missing).
 *   2. For each article in agents/enclave/rulebook/unidroit-v1.json:
 *        - Register `chapter-X-Y.rulebook.tribunal.eth` (idempotent).
 *        - Set text records: `description`, `tribunal.title`, `tribunal.chapter`.
 *   3. For each article, call `RuleBook.addArticle(articleId, ensNode, chapter)`
 *      on 0G Galileo (idempotent — contract rejects duplicates).
 *   4. Transfer RuleBook governorship from deployer to `RuleBookGovernor`.
 *
 * Env required:
 *   ENS_RPC_URL          Sepolia RPC for ENS writes
 *   ENS_PRIVATE_KEY      signer that owns tribunal.eth (will own subnames too)
 *   OG_RPC_URL           0G Galileo RPC (default https://evmrpc-testnet.0g.ai)
 *   PRIVATE_KEY          deployer key on 0G — must be the initial RuleBook governor
 *
 * Optional:
 *   --limit N            seed only the first N articles (for testing)
 *   --skip-transfer      don't transfer governorship at the end
 *   --network localhost  run RuleBook calls against http://127.0.0.1:8545 instead
 *                        of 0G Galileo (uses PRIVATE_KEY against the local hardhat)
 *
 * Usage:
 *   npx tsx scripts/seed-rulebook-ens.ts                        # full run, 58 articles
 *   npx tsx scripts/seed-rulebook-ens.ts --limit 2              # smoke test
 *   npx tsx scripts/seed-rulebook-ens.ts --network localhost    # local hardhat
 */

import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { publishAgentEnsRecords } from "../agents/src/identity/ens.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface Article { id: string; title: string; body: string }

function parseArgs(): { limit?: number; skipTransfer: boolean; network: "0g" | "localhost" } {
  const argv = process.argv.slice(2);
  let limit: number | undefined;
  let skipTransfer = false;
  let network: "0g" | "localhost" = "0g";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--limit") limit = Number(argv[++i]);
    else if (argv[i] === "--skip-transfer") skipTransfer = true;
    else if (argv[i] === "--network" && argv[i + 1] === "localhost") { network = "localhost"; i++; }
  }
  return { limit, skipTransfer, network };
}

function envOrThrow(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

function chapterSlug(articleId: string): string {
  return `chapter-${articleId.replace(/\./g, "-")}`;
}
function chapterFromId(articleId: string): string {
  const parts = articleId.split(".");
  if (parts.length === 1) return parts[0]!;
  return parts.slice(0, parts.length === 2 ? 1 : 2).join(".");
}

const RULEBOOK_ABI = [
  "function articleCount() view returns (uint256)",
  "function articleAt(uint256) view returns (tuple(string articleId,bytes32 ensNode,string chapter,uint64 addedAt))",
  "function exists(string articleId) view returns (bool)",
  "function addArticle(string articleId, bytes32 ensNode, string chapter) returns (uint256)",
  "function transferGovernor(address newGovernor)",
  "function governor() view returns (address)",
];

async function main() {
  const args = parseArgs();
  const ensRpc = envOrThrow("ENS_RPC_URL");
  const rawEnsPk = envOrThrow("ENS_PRIVATE_KEY");
  const ensPk = (rawEnsPk.startsWith("0x") ? rawEnsPk : `0x${rawEnsPk}`) as `0x${string}`;
  const parentTld = process.env.ENS_PARENT_NAME ?? "tribunal.eth";
  const rulebookSubdomain = `rulebook.${parentTld}`;

  // 0G config — or local hardhat fallback for testing.
  const rpcUrl = args.network === "localhost"
    ? "http://127.0.0.1:8545"
    : (process.env.OG_RPC_URL ?? "https://evmrpc-testnet.0g.ai");
  const ogPk = (() => {
    const raw = envOrThrow("PRIVATE_KEY");
    return raw.startsWith("0x") ? raw : `0x${raw}`;
  })();

  // Load deployment.
  const dep = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../docs/deployment.json"), "utf8"),
  );
  if (!dep.RuleBook || !dep.RuleBookGovernor) {
    throw new Error("RuleBook / RuleBookGovernor missing from docs/deployment.json. Re-run deploy.");
  }
  console.log(`RuleBook:         ${dep.RuleBook}`);
  console.log(`RuleBookGovernor: ${dep.RuleBookGovernor}`);
  console.log(`Parent ENS:       ${parentTld}  →  ${rulebookSubdomain}`);
  console.log(`Network:          ${args.network} (${rpcUrl})`);

  // Load articles.
  const articleFile = path.resolve(__dirname, "../agents/enclave/rulebook/unidroit-v1.json");
  const articles = (JSON.parse(fs.readFileSync(articleFile, "utf8")) as { articles: Article[] }).articles;
  const slice = args.limit ? articles.slice(0, args.limit) : articles;
  console.log(`Seeding ${slice.length}/${articles.length} article(s)`);

  // ---- Step 1: ensure rulebook.tribunal.eth subname exists on Sepolia ----
  console.log(`\n[1/4] Ensuring ${rulebookSubdomain} exists on Sepolia...`);
  await publishAgentEnsRecords({
    rpcUrl: ensRpc,
    privateKey: ensPk,
    parentName: parentTld,
    label: "rulebook",
    records: {}, // creating with parent's resolver is enough
  });
  console.log(`✓ ${rulebookSubdomain} ready`);

  // ---- Step 2: register subname + text records per article on Sepolia ----
  console.log(`\n[2/4] Publishing ENS subnames + text records on Sepolia...`);
  const { namehash } = await import("viem");
  const seeded: { articleId: string; ensNode: `0x${string}`; chapter: string; ensName: string }[] = [];
  for (let i = 0; i < slice.length; i++) {
    const a = slice[i]!;
    const label = chapterSlug(a.id);
    const ensName = `${label}.${rulebookSubdomain}`;
    const ensNode = namehash(ensName) as `0x${string}`;
    const chapter = chapterFromId(a.id);
    process.stdout.write(`  [${i + 1}/${slice.length}] ${ensName} ... `);
    try {
      await publishAgentEnsRecords({
        rpcUrl: ensRpc,
        privateKey: ensPk,
        parentName: rulebookSubdomain,
        label,
        records: {
          description: a.body,
          "tribunal.title": a.title,
          "tribunal.chapter": chapter,
        },
      });
      seeded.push({ articleId: a.id, ensNode, chapter, ensName });
      console.log("ok");
    } catch (e) {
      console.log(`FAILED: ${(e as Error).message}`);
    }
  }
  console.log(`Published ${seeded.length}/${slice.length} ENS subnames`);

  // ---- Step 3: addArticle on the RuleBook contract ----
  console.log(`\n[3/4] Registering articles on RuleBook (${args.network})...`);
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(ogPk, provider);
  const rb = new ethers.Contract(dep.RuleBook, RULEBOOK_ABI, wallet);
  const currentGovernor = await rb.governor();
  if (currentGovernor.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error(
      `Wallet ${wallet.address} is not the current RuleBook governor (${currentGovernor}). ` +
      `Either pass the deployer's PRIVATE_KEY, or governorship has already been transferred.`,
    );
  }
  let added = 0;
  for (let i = 0; i < seeded.length; i++) {
    const e = seeded[i]!;
    process.stdout.write(`  [${i + 1}/${seeded.length}] addArticle("${e.articleId}") ... `);
    try {
      if (await rb.exists(e.articleId)) {
        console.log("already exists, skipping");
        continue;
      }
      const tx = await rb.addArticle(e.articleId, e.ensNode, e.chapter);
      await tx.wait();
      added += 1;
      console.log(`ok (tx ${tx.hash.slice(0, 10)}…)`);
    } catch (err) {
      console.log(`FAILED: ${(err as Error).message}`);
    }
  }
  console.log(`Added ${added}/${seeded.length} articles to RuleBook`);

  // ---- Step 4: transfer governor (unless --skip-transfer) ----
  if (args.skipTransfer) {
    console.log(`\n[4/4] Skipped governor transfer (--skip-transfer).`);
    return;
  }
  console.log(`\n[4/4] Transferring RuleBook governor → ${dep.RuleBookGovernor}...`);
  const tx = await rb.transferGovernor(dep.RuleBookGovernor);
  await tx.wait();
  const newGov = await rb.governor();
  console.log(`✓ Governor now ${newGov}`);
  console.log(`\nDone.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
