/// REE → on-chain smoke. Proves the verifiable-inference loop end-to-end:
///
///   1. Hit the running enclave's POST /complete → get back text + a real
///      Gensyn REE receipt (hash, url).
///   2. File + accept a Tribunal case against a fresh judge admitted on
///      AgentRegistry.
///   3. Judge submitRuling → status flips to Ruled.
///   4. Owner calls TribunalCore.finalizeVerdictWithReceipt(...) which
///      posts the verdict to VerdictLog AND attaches the REE receipt in
///      the same tx.
///   5. Read back VerdictLog.receipts(caseId) and confirm hash + url
///      match what /complete returned.
///
/// Prereqs:
///   - Hardhat node running on :8545 with contracts deployed (deployment.json fresh)
///   - Enclave running on :9000 (REE_URL points here)
///
/// Usage:
///   npx tsx scripts/ree-onchain-smoke.ts

import * as fs from "node:fs";
import * as path from "node:path";
import { ethers, JsonRpcProvider, Wallet } from "ethers";

const REPO = path.resolve(__dirname, "..");
const REE_URL = process.env.REE_URL ?? "http://127.0.0.1:9000";
const RPC_URL = process.env.OG_RPC_URL ?? "http://127.0.0.1:8545";

function loadAbi(name: string): any[] {
  const p = path.join(REPO, "contracts", "artifacts", "src", `${name}.sol`, `${name}.json`);
  return JSON.parse(fs.readFileSync(p, "utf8")).abi;
}

async function callComplete(): Promise<{ text: string; hash: `0x${string}`; url: string }> {
  const res = await fetch(`${REE_URL}/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      system: "You are a judge. Reply in JSON.",
      messages: [{ role: "user", content: 'The accuser proved their case. Reply: {"prevailingIsAccuser":true}' }],
      maxTokens: 24,
    }),
  });
  if (!res.ok) throw new Error(`enclave ${res.status}: ${await res.text().catch(() => "")}`);
  const j = (await res.json()) as { text: string; receipt: { hash: `0x${string}`; url: string } };
  if (!j.receipt?.hash) throw new Error(`enclave returned no receipt: ${JSON.stringify(j)}`);
  return { text: j.text, hash: j.receipt.hash, url: j.receipt.url };
}

async function main() {
  console.log(`[smoke] enclave=${REE_URL} rpc=${RPC_URL}`);

  const dep = JSON.parse(fs.readFileSync(path.join(REPO, "docs", "deployment.json"), "utf8"));
  const provider = new JsonRpcProvider(RPC_URL);

  // Hardhat well-known dev keys
  const owner = new Wallet("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", provider);
  const accuser = new Wallet("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", provider);
  const defendant = new Wallet("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", provider);
  const judge = new Wallet("0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6", provider);

  const registry = new ethers.Contract(dep.AgentRegistry, loadAbi("AgentRegistry"), owner);
  const tribunalAsOwner = new ethers.Contract(dep.TribunalCore, loadAbi("TribunalCore"), owner);
  const tribunalAsAccuser = new ethers.Contract(dep.TribunalCore, loadAbi("TribunalCore"), accuser);
  const tribunalAsJudge = new ethers.Contract(dep.TribunalCore, loadAbi("TribunalCore"), judge);
  const verdictLog = new ethers.Contract(dep.VerdictLog, loadAbi("VerdictLog"), provider);

  // Admit judge (idempotent)
  const role = await registry.roleOf(judge.address);
  if (Number(role) !== 1) {
    console.log(`[smoke] admitting judge ${judge.address}`);
    await (await registry.admitJudge(judge.address)).wait();
  }

  // 1. Real REE inference
  console.log("[smoke] calling /complete on enclave (warm path: ~30–60s on Qwen 0.5B CPU)...");
  const t0 = Date.now();
  const ree = await callComplete();
  console.log(`[smoke] enclave returned in ${Date.now() - t0}ms`);
  console.log(`[smoke] receipt: ${ree.hash}`);
  console.log(`[smoke] text:    ${ree.text}`);

  // 2. File case
  const baseFee = ethers.parseEther("0.01");
  const filedRc = await (await tribunalAsAccuser.fileCase(
    defendant.address, ethers.ZeroAddress, 0, "ipfs://accusation-mock", { value: baseFee },
  )).wait();
  const filedEv = filedRc!.logs
    .map((l: any) => { try { return tribunalAsAccuser.interface.parseLog(l); } catch { return null; } })
    .find((e: any) => e?.name === "CaseFiled");
  const caseId: bigint = filedEv!.args.caseId;
  console.log(`[smoke] filed case #${caseId}`);

  // 3. Accept case with single-judge panel
  await (await tribunalAsOwner.acceptCase(caseId, [judge.address], 1)).wait();
  console.log(`[smoke] accepted case #${caseId} with judge ${judge.address}`);

  // 4. Judge submits ruling
  const opinion = "The transcript supports the accuser; defendant produced no contrary evidence.";
  const opinionHash = ethers.keccak256(ethers.toUtf8Bytes(opinion)) as `0x${string}`;
  await (await tribunalAsJudge.submitRuling(caseId, true, opinionHash)).wait();
  console.log(`[smoke] judge submitted ruling`);

  // 5. Owner finalizes with REE receipt anchored on-chain
  const opinionRoot = opinionHash;
  const tx = await tribunalAsOwner.finalizeVerdictWithReceipt(
    caseId, dep.VerdictLog, opinionRoot, ree.hash, ree.url,
  );
  const finRc = await tx.wait();
  console.log(`[smoke] finalizeVerdictWithReceipt tx ${finRc!.hash}`);

  // 6. Read back the on-chain receipt and assert it matches /complete
  const onchain = await verdictLog.receipts(caseId);
  const ok = onchain.exists
    && onchain.receiptHash.toLowerCase() === ree.hash.toLowerCase()
    && onchain.receiptUrl === ree.url;

  console.log("[smoke] on-chain receipts(caseId):");
  console.log(`  exists      = ${onchain.exists}`);
  console.log(`  receiptHash = ${onchain.receiptHash}`);
  console.log(`  receiptUrl  = ${onchain.receiptUrl}`);

  if (!ok) {
    console.error("[smoke] FAIL: on-chain receipt does not match /complete output");
    process.exit(1);
  }
  console.log("[smoke] OK — REE receipt round-tripped from /complete to VerdictLog");
}

main().catch((e) => { console.error(e); process.exit(1); });
