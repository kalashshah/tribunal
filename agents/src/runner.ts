/**
 * End-to-end runner: drives a single dispute through Tribunal from filing
 * to verdict. Used both as the demo script and as the hackathon smoke test.
 *
 * Pre-conditions (you set these up first):
 *   - Contracts deployed (run `cd contracts && npm run deploy:local` or :0g)
 *     so `docs/deployment.json` exists.
 *   - Four AXL nodes running locally on different ports — the runner reads
 *     each peer's API base URL from env.
 *   - .env contains OG_RPC_URL, OG_PRIVATE_KEY, ANTHROPIC_API_KEY.
 *
 * What it does:
 *   1. Loads contracts via ethers.
 *   2. Reads the four AXL peer ids and constructs senders/receivers.
 *   3. Registers four agents (accuser, defendant, judge, two lawyers) on the
 *      AgentRegistry if not already registered.
 *   4. Mints one judge iNFT.
 *   5. Opens an escrow funded with mock USDC, then files a case against it.
 *   6. Accepts the case with a single-judge panel (threshold = 1).
 *   7. Runs the trial: opening A, opening B, rebuttal A, rebuttal B,
 *      closing A, closing B.
 *   8. Judge deliberates and submits a ruling.
 *   9. Posts the verdict to VerdictLog and marks the case settled.
 *  10. Prints the on-chain status.
 *
 * To run:
 *   cd agents && npm run build && node dist/runner.js
 */

import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers, JsonRpcProvider, Wallet } from "ethers";

import { createAxlClient, subscribe, AxlClient } from "./transport/axl.js";
import { pickLlmFromEnv } from "./llm/index.js";
import { createTribunalClient } from "./chain/tribunal-client.js";
import { createClerk } from "./roles/clerk.js";
import { createLawyer } from "./roles/lawyer.js";
import { createJudge } from "./roles/judge.js";
import type { ZgStorage } from "./storage/og-storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface DeploymentJson {
  network: string;
  AgentRegistry: string;
  TribunalCore: string;
  EscrowAdapter: string;
  VerdictLog: string;
  JudgeINFT: string;
}

function envOrThrow(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

function loadAbi(contractName: string): any[] {
  const p = path.resolve(
    __dirname,
    `../../contracts/artifacts/src/${contractName}.sol/${contractName}.json`,
  );
  return JSON.parse(fs.readFileSync(p, "utf8")).abi;
}

/// In-memory storage stub for hackathon demos when 0G Storage isn't reachable.
/// Replace with createZgStorage(...) once OG_RPC_URL + indexer URL are wired.
function inMemoryStorage(): ZgStorage {
  const blobs = new Map<string, Uint8Array>();
  return {
    async upload(bytes) {
      const rootHash = ethers.keccak256(bytes) as `0x${string}`;
      blobs.set(rootHash, bytes);
      return { rootHash, txHash: rootHash };
    },
    async download(rootHash) {
      const b = blobs.get(rootHash);
      if (!b) throw new Error(`blob ${rootHash} not found`);
      return b;
    },
  };
}

async function main() {
  const rpcUrl = envOrThrow("OG_RPC_URL");
  const provider = new JsonRpcProvider(rpcUrl);

  const deploymentPath = path.resolve(__dirname, "../../docs/deployment.json");
  const dep = JSON.parse(fs.readFileSync(deploymentPath, "utf8")) as DeploymentJson;
  console.log("Loaded deployment for chain", dep.network);

  // Wallets — one per role. For local hardhat we use the well-known dev keys;
  // for 0G testnet you'd derive from a single funded key + a runtime nonce
  // strategy. Keeping it simple here.
  const operator = new Wallet(envOrThrow("OG_PRIVATE_KEY"), provider);
  console.log("Operator:", operator.address);

  const tribunalCore = new ethers.Contract(dep.TribunalCore, loadAbi("TribunalCore"), operator);
  const judgeINFT    = new ethers.Contract(dep.JudgeINFT,    loadAbi("JudgeINFT"),    operator);
  const verdictLog   = new ethers.Contract(dep.VerdictLog,   loadAbi("VerdictLog"),   operator);
  const tribunal = createTribunalClient({
    tribunalCore: tribunalCore as any,
    judgeINFT:    judgeINFT    as any,
    verdictLog:   verdictLog   as any,
  });

  const picked = pickLlmFromEnv();
  console.log(`LLM: ${picked.provider} (${picked.model})`);
  const llm = picked.llm;

  // AXL — four nodes on consecutive ports. Override via env if your config
  // differs; defaults match the docs/protocols/axl-spike-notes.md layout.
  const axlBase = process.env.AXL_BASE_URL ?? "http://127.0.0.1";
  const clerkAxl  = createAxlClient({ baseUrl: `${axlBase}:${process.env.AXL_PORT_CLERK ?? 9002}` });
  const lawyerAaxl= createAxlClient({ baseUrl: `${axlBase}:${process.env.AXL_PORT_LAWYER_A ?? 9012}` });
  const lawyerBaxl= createAxlClient({ baseUrl: `${axlBase}:${process.env.AXL_PORT_LAWYER_B ?? 9022}` });
  const judgeAxl  = createAxlClient({ baseUrl: `${axlBase}:${process.env.AXL_PORT_JUDGE ?? 9032}` });

  const clerkPeer  = await clerkAxl.peerId();
  const judgePeer  = await judgeAxl.peerId();
  const lawyerAPeer= await lawyerAaxl.peerId();
  const lawyerBPeer= await lawyerBaxl.peerId();
  console.log({ clerkPeer, judgePeer, lawyerAPeer, lawyerBPeer });

  // Register agents (idempotent: catches duplicate-ENS reverts).
  async function registerOrSkip(ensName: string, role: string): Promise<bigint> {
    try {
      const reg = new ethers.Contract(dep.AgentRegistry, loadAbi("AgentRegistry"), operator);
      const tx = await reg.register(ensName, role);
      const rc = await tx.wait();
      const ev = rc!.logs
        .map((l: any) => { try { return reg.interface.parseLog(l); } catch { return null; } })
        .find((e: any) => e?.name === "AgentRegistered");
      return ev!.args.id as bigint;
    } catch (e: any) {
      const reg = new ethers.Contract(dep.AgentRegistry, loadAbi("AgentRegistry"), provider);
      const id = (await reg.idByEns(ensName)) as bigint;
      console.log(`Reused ${ensName} -> id ${id}`);
      return id;
    }
  }

  const accuserId  = await registerOrSkip("alice.tribunal.eth",       "litigant");
  const defendantId= await registerOrSkip("bob.tribunal.eth",         "litigant");
  const judgeAgentId = await registerOrSkip("judge-athena.tribunal.eth", "judge");

  // Mint judge iNFT (skip if one already exists owned by operator).
  let judgeTokenId = 1n;
  try {
    const tx = await judgeINFT.mint(
      operator.address,
      ethers.id("encryptedPersona-textualist-v1"),
      "data:application/json,judge-athena.persona",
    );
    const rc = await tx.wait();
    const ev = rc!.logs
      .map((l: any) => { try { return judgeINFT.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "MetadataRootUpdated");
    judgeTokenId = ev!.args.tokenId as bigint;
    console.log(`Minted judge iNFT #${judgeTokenId}`);
  } catch (e) {
    console.log("Mint skipped (may already exist), using token id 1");
  }

  // File the case (no escrow for the smoke run; pass ZeroAddress).
  const filedTx = await tribunalCore.fileCase(
    accuserId,
    defendantId,
    ethers.ZeroAddress,
    0,
    "ipfs://accusation-mock",
  );
  const filedRc = await filedTx.wait();
  const filedEv = filedRc!.logs
    .map((l: any) => { try { return tribunalCore.interface.parseLog(l); } catch { return null; } })
    .find((e: any) => e?.name === "CaseFiled");
  const caseId: bigint = filedEv!.args.caseId;
  console.log(`Filed case #${caseId}`);

  await tribunal.acceptCase(caseId, [judgeAgentId], 1n);
  console.log(`Accepted case with single-judge panel`);

  // Set up clerk to listen on its AXL queue.
  const storage = inMemoryStorage();
  const clerk = createClerk({
    caseId,
    storage,
    tribunal,
    forward: (ev) => { console.log(`[clerk] seq ${ev.seq} ${ev.kind} from ${ev.from}`); },
  });
  const stopSubscribe = subscribe(clerkAxl, async (env) => {
    await clerk.handleIncoming(env);
  });

  // Lawyers + judge.
  const lawyerA = createLawyer({
    side: "accuser",
    brief: "Alice claims she delivered a market-research report on 2026-04-20 at 14:00 UTC; Bob disputes receipt.",
    ensName: "lawyer-quinn.tribunal.eth",
    clerkPeerId: clerkPeer,
    caseId: caseId.toString(),
    llm,
    axl: lawyerAaxl,
    model: "claude-sonnet-4-6",
  });
  const lawyerB = createLawyer({
    side: "defendant",
    brief: "Bob never received the report; only an empty-payload notification arrived.",
    ensName: "lawyer-rivers.tribunal.eth",
    clerkPeerId: clerkPeer,
    caseId: caseId.toString(),
    llm,
    axl: lawyerBaxl,
    model: "claude-sonnet-4-6",
  });
  const judge = createJudge({
    ensName: "judge-athena.tribunal.eth",
    caseId,
    tokenId: judgeTokenId,
    personaPrompt: "You are a careful textualist. Rule on what was actually written, not what parties wished was written.",
    priorRulings: [],
    llm,
    axl: judgeAxl,
    tribunal,
    clerkPeerId: clerkPeer,
    model: "claude-sonnet-4-6",
  });

  // Drive the trial. Each step waits a beat for the clerk to ingest.
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  console.log("\n--- opening statements ---");
  const openA = await lawyerA.openingStatement();
  await wait(800);
  const openB = await lawyerB.openingStatement();
  await wait(800);

  console.log("\n--- rebuttals ---");
  await lawyerA.rebuttal(openB);
  await wait(800);
  await lawyerB.rebuttal(openA);
  await wait(800);

  console.log("\n--- closings ---");
  const transcriptText = clerk.render();
  await lawyerA.closingStatement(transcriptText);
  await wait(800);
  await lawyerB.closingStatement(transcriptText);
  await wait(1000);

  console.log("\n--- judge deliberation ---");
  const ruling = await judge.deliberateAndRule(clerk.render());
  console.log("Verdict:", ruling);

  // Post to VerdictLog and mark settled.
  const opinionRoot = ethers.keccak256(ethers.toUtf8Bytes(ruling.opinion)) as `0x${string}`;
  if (tribunal.postVerdict) await tribunal.postVerdict(caseId, ruling.prevailingIsAccuser, opinionRoot);
  await tribunal.markSettled(caseId);

  const status = await tribunalCore.caseStatus(caseId);
  const prevailing = await tribunalCore.casePrevailing(caseId);
  console.log(`On-chain: caseStatus=${status} prevailingIsAccuser=${prevailing}`);

  stopSubscribe();
}

main().catch((e) => { console.error(e); process.exit(1); });
