/**
 * Local demo runner. Drives a complete trial against a local hardhat node
 * with NO external services:
 *   - In-memory AXL bus instead of the Go AXL binary
 *   - Canned LLM instead of Anthropic API
 *   - In-memory 0G Storage (just an object map)
 *
 * Prereqs: contracts deployed to a local hardhat node (chainId 31337) with
 *          addresses written to docs/deployment.json. The script
 *          `scripts/demo.sh` wraps this together.
 *
 * Usage:
 *   node agents/dist/demo.js
 *
 * What it asserts at the end:
 *   - Case status is Ruled (5)
 *   - prevailingIsAccuser matches the canned ruling (true)
 *   - JudgeINFT.rulingHistory grew by one entry
 *   - Verdict was posted to VerdictLog
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as dotenv from "dotenv";
import { ethers, JsonRpcProvider, Wallet } from "ethers";

// Load .env from the repo root regardless of cwd.
dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.env") });

import { createInMemoryBus } from "./transport/in-memory.js";
import { createAxlClient, subscribe, type AxlClient } from "./transport/axl.js";
import { pickLlmFromEnv } from "./llm/index.js";
import { createTribunalClient } from "./chain/tribunal-client.js";
import { createClerk } from "./roles/clerk.js";
import { createLawyer } from "./roles/lawyer.js";
import { createJudge } from "./roles/judge.js";
import { createPartyAgent } from "./roles/party.js";
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

function loadAbi(contractName: string): any[] {
  const p = path.resolve(
    __dirname,
    `../../contracts/artifacts/src/${contractName}.sol/${contractName}.json`,
  );
  return JSON.parse(fs.readFileSync(p, "utf8")).abi;
}

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

function log(section: string, msg: string) {
  console.log(`\x1b[2m[${section.padEnd(10)}]\x1b[0m ${msg}`);
}

async function main() {
  const rpcUrl = process.env.OG_RPC_URL ?? "http://127.0.0.1:8545";
  const provider = new JsonRpcProvider(rpcUrl);

  const deploymentPath = path.resolve(__dirname, "../../docs/deployment.json");
  const dep = JSON.parse(fs.readFileSync(deploymentPath, "utf8")) as DeploymentJson;
  log("setup", `loaded deployment for chain ${dep.network}`);

  // Hardhat well-known dev keys. Plenty for the demo; nothing leaves the box.
  const ACCOUNTS = [
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // 0
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // 1 - accuser
    "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // 2 - defendant
    "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6", // 3 - judge
    "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a", // 4 - lawyer A
    "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba", // 5 - lawyer B
  ];
  // For 0G testnet (or any chain other than the local hardhat network) we
  // need the operator to fund the role wallets first — they're hardhat
  // dev keys and have no balance off-chain.
  const operator: Wallet = process.env.OG_PRIVATE_KEY && (await provider.getNetwork()).chainId !== 31337n
    ? new Wallet(process.env.OG_PRIVATE_KEY, provider)
    : new Wallet(ACCOUNTS[0]!, provider);
  const accuser    = new Wallet(ACCOUNTS[1]!, provider);
  const defendant  = new Wallet(ACCOUNTS[2]!, provider);
  const judgeOwner = new Wallet(ACCOUNTS[3]!, provider);

  const TOP_UP = ethers.parseEther("0.05");
  for (const w of [accuser, defendant, judgeOwner]) {
    const bal = await provider.getBalance(w.address);
    if (bal < TOP_UP / 2n) {
      log("fund", `topping up ${w.address} from ${operator.address}`);
      const tx = await operator.sendTransaction({ to: w.address, value: TOP_UP });
      await tx.wait();
    }
  }

  const registry = new ethers.Contract(dep.AgentRegistry, loadAbi("AgentRegistry"), operator);
  const tribunalCore = new ethers.Contract(dep.TribunalCore, loadAbi("TribunalCore"), operator);
  const judgeINFT    = new ethers.Contract(dep.JudgeINFT,    loadAbi("JudgeINFT"),    operator);
  const verdictLog   = new ethers.Contract(dep.VerdictLog,   loadAbi("VerdictLog"),   operator);

  // The judge submits its ruling on its own behalf and also appends to its
  // iNFT memory (it's the owner) — so it needs both contract handles bound
  // to the judge's wallet, not the operator's.
  const tribunalAsJudge = new ethers.Contract(dep.TribunalCore, loadAbi("TribunalCore"), judgeOwner);
  const judgeINFTAsJudge = new ethers.Contract(dep.JudgeINFT, loadAbi("JudgeINFT"), judgeOwner);
  const tribunalAsAccuser = new ethers.Contract(dep.TribunalCore, loadAbi("TribunalCore"), accuser);

  // Register agents (idempotent).
  async function registerOrLookup(signer: Wallet, ens: string, role: string): Promise<bigint> {
    const r = registry.connect(signer) as any;
    try {
      const tx = await r.register(ens, role);
      await tx.wait();
    } catch { /* already registered */ }
    return (await registry.idByEns(ens)) as bigint;
  }
  const accuserId  = await registerOrLookup(accuser,    "alice.tribunal.eth",       "litigant");
  const defendantId= await registerOrLookup(defendant,  "bob.tribunal.eth",         "litigant");
  const judgeAgentId = await registerOrLookup(judgeOwner, "judge-athena.tribunal.eth", "judge");
  log("registry", `accuser=${accuserId} defendant=${defendantId} judge=${judgeAgentId}`);

  // Mint judge iNFT (skip silently if any token already exists for this owner).
  let judgeTokenId = 1n;
  try {
    const tx = await judgeINFT.mint(
      judgeOwner.address,
      ethers.id("encryptedPersona-textualist-v1"),
      "data:application/json,judge-athena.persona",
    );
    const rc = await tx.wait();
    const ev = rc!.logs
      .map((l: any) => { try { return judgeINFT.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "MetadataRootUpdated");
    judgeTokenId = ev!.args.tokenId as bigint;
    log("judges", `minted iNFT token #${judgeTokenId} for ${judgeOwner.address}`);
  } catch (e: any) {
    log("judges", `skipped mint (${e.message?.slice(0, 60)}); using token #1`);
  }
  const initialHistoryLen = ((await judgeINFT.rulingHistory(judgeTokenId)) as string[]).length;

  // File the case from the accuser, no escrow for simplicity.
  const filedTx = await tribunalAsAccuser.fileCase(
    accuserId, defendantId, ethers.ZeroAddress, 0, "ipfs://accusation-mock",
  );
  const filedRc = await filedTx.wait();
  const filedEv = filedRc!.logs
    .map((l: any) => { try { return tribunalCore.interface.parseLog(l); } catch { return null; } })
    .find((e: any) => e?.name === "CaseFiled");
  const caseId: bigint = filedEv!.args.caseId;
  log("file", `case #${caseId} filed by accuser`);

  await (await tribunalCore.acceptCase(caseId, [judgeAgentId], 1n)).wait();
  log("accept", `case #${caseId} accepted, single-judge panel`);

  // Wire the agent runtime. Default uses an in-memory bus; set
  // AXL_USE_REAL=1 to talk to four real AXL Go nodes on the standard
  // port layout (9002 clerk / 9012 lawyer-A / 9022 lawyer-B / 9032 judge).
  const useRealAxl = process.env.AXL_USE_REAL === "1";
  let clerkAxl: AxlClient, lawyerAaxl: AxlClient, lawyerBaxl: AxlClient, judgeAxl: AxlClient;
  let clerkPeer: string;
  if (useRealAxl) {
    clerkAxl   = createAxlClient({ baseUrl: process.env.AXL_CLERK_URL    ?? "http://127.0.0.1:9002" });
    lawyerAaxl = createAxlClient({ baseUrl: process.env.AXL_LAWYER_A_URL ?? "http://127.0.0.1:9012" });
    lawyerBaxl = createAxlClient({ baseUrl: process.env.AXL_LAWYER_B_URL ?? "http://127.0.0.1:9022" });
    judgeAxl   = createAxlClient({ baseUrl: process.env.AXL_JUDGE_URL    ?? "http://127.0.0.1:9032" });
    clerkPeer  = await clerkAxl.peerId();
    log("axl", `using real AXL nodes; clerk peer ${clerkPeer.slice(0, 16)}…`);
  } else {
    const bus = createInMemoryBus();
    clerkAxl   = bus.newClient("CLERK");
    lawyerAaxl = bus.newClient("LAWYER_A");
    lawyerBaxl = bus.newClient("LAWYER_B");
    judgeAxl   = bus.newClient("JUDGE");
    clerkPeer  = "CLERK";
  }
  const picked = pickLlmFromEnv();
  log("llm", `using ${picked.provider} (${picked.model})`);
  const llm = picked.llm;
  const storage = inMemoryStorage();

  const tribunal = createTribunalClient({
    tribunalCore: tribunalCore as any,
    judgeINFT:    judgeINFT    as any,
    verdictLog:   verdictLog   as any,
  });
  // Judge's own client: submitRuling + appendRulingMemory both signed by judge.
  const tribunalForJudge = createTribunalClient({
    tribunalCore: tribunalAsJudge   as any,
    judgeINFT:    judgeINFTAsJudge  as any,
  });

  const clerk = createClerk({
    caseId,
    storage,
    tribunal,
    forward: (ev) => log("trial", `[seq ${ev.seq}] ${ev.kind} from ${ev.from}: ${ev.body.slice(0, 80)}…`),
  });
  const stopSubscribe = subscribe(clerkAxl, async (env) => { await clerk.handleIncoming(env); }, { idleBackoffMs: 10 });

  const partyEns = { accuser: "alice.tribunal.eth", defendant: "bob.tribunal.eth" };
  const accusation = "Alice claims she delivered a research report on 2026-04-20.";
  const accuserPartyAgent = createPartyAgent({
    side: "accuser",
    ensName: partyEns.accuser,
    accusation,
    llm,
    model: "demo",
  });
  const defendantPartyAgent = createPartyAgent({
    side: "defendant",
    ensName: partyEns.defendant,
    accusation,
    llm,
    model: "demo",
  });
  const lawyerA = createLawyer({
    side: "accuser",
    brief: accusation,
    ensName: "lawyer-quinn.tribunal.eth",
    clientEns: partyEns.accuser,
    opponentEns: partyEns.defendant,
    partyEns,
    clerkPeerId: clerkPeer,
    caseId: caseId.toString(),
    llm, axl: lawyerAaxl, model: "demo",
    partyAgent: accuserPartyAgent,
    getTranscript: () => clerk.render(),
  });
  const lawyerB = createLawyer({
    side: "defendant",
    brief: "Bob never received the substantive report.",
    ensName: "lawyer-rivers.tribunal.eth",
    clientEns: partyEns.defendant,
    opponentEns: partyEns.accuser,
    partyEns,
    clerkPeerId: clerkPeer,
    caseId: caseId.toString(),
    llm, axl: lawyerBaxl, model: "demo",
    partyAgent: defendantPartyAgent,
    getTranscript: () => clerk.render(),
  });
  const judge = createJudge({
    ensName: "judge-athena.tribunal.eth",
    caseId,
    tokenId: judgeTokenId,
    personaPrompt: "You are a careful textualist.",
    priorRulings: [],
    llm,
    axl: judgeAxl,
    tribunal: tribunalForJudge,
    clerkPeerId: clerkPeer,
    model: "demo",
    partyEns,
    partyAgents: { accuser: accuserPartyAgent, defendant: defendantPartyAgent },
    getTranscript: () => clerk.render(),
  });

  const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

  log("trial", "--- opening statements ---");
  const openA = await lawyerA.openingStatement();
  await settle(50);
  const openB = await lawyerB.openingStatement();
  await settle(50);

  log("trial", "--- rebuttals ---");
  await lawyerA.rebuttal(openB);
  await settle(50);
  await lawyerB.rebuttal(openA);
  await settle(50);

  log("trial", "--- closings ---");
  await lawyerA.closingStatement(clerk.render());
  await settle(50);
  await lawyerB.closingStatement(clerk.render());
  await settle(100);

  // Drain the clerk's subscribe queue before deliberation so the full
  // transcript reaches the judge and the trial log is complete.
  while (clerk.transcript().length < 6) await settle(50);

  log("trial", "--- judge deliberation ---");
  const ruling = await judge.deliberateAndRule(clerk.render());
  log("verdict", `prevailingIsAccuser=${ruling.prevailingIsAccuser}`);

  // Post verdict + mark settled in a single tx via TribunalCore (would
  // normally be triggered by KeeperHub on the production deployment).
  const opinionRoot = ethers.keccak256(ethers.toUtf8Bytes(ruling.opinion)) as `0x${string}`;
  await tribunal.finalizeVerdict(caseId, dep.VerdictLog, opinionRoot);

  stopSubscribe();

  // Assertions.
  const status = Number(await tribunalCore.caseStatus(caseId));
  const prevailing = await tribunalCore.casePrevailing(caseId);
  const history = (await judgeINFT.rulingHistory(judgeTokenId)) as string[];
  const verdict = await verdictLog.verdicts(caseId);

  function assert(name: string, cond: boolean, msg: string) {
    if (!cond) {
      console.error(`\x1b[31m✗\x1b[0m ${name} — ${msg}`);
      process.exitCode = 1;
    } else {
      console.log(`\x1b[32m✓\x1b[0m ${name}`);
    }
  }

  console.log("\n--- assertions ---");
  assert("case status is Settled", status === 6, `got ${status}`);
  assert("prevailing matches ruling", prevailing === ruling.prevailingIsAccuser, `got ${prevailing}`);
  assert("judge memory grew", history.length === initialHistoryLen + 1, `len ${history.length} want ${initialHistoryLen + 1}`);
  assert("verdict posted", verdict.exists === true, `verdict.exists=${verdict.exists}`);
  assert("verdict prevailing matches", verdict.prevailingIsAccuser === ruling.prevailingIsAccuser, "");

  if (process.exitCode === 1) {
    console.error("\nDemo FAILED.");
  } else {
    console.log("\n\x1b[32mDemo PASSED.\x1b[0m");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
