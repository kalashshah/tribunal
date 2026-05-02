/**
 * Chain-driven runner: subscribes to TribunalCore.CaseFiled and processes
 * each filed case end-to-end.
 *
 * Pre-conditions:
 *   - Contracts deployed (docs/deployment.json present).
 *   - Four AXL nodes running locally (clerk + 2 lawyers + judge).
 *   - .env contains OG_RPC_URL, OG_PRIVATE_KEY, OPENROUTER_API_KEY.
 *   - Optional: OG_STORAGE_URL for real 0G Storage; else falls back to in-memory.
 *
 * What it does on startup:
 *   1. Loads contracts via ethers.
 *   2. Boots AXL clients + LLM + 0G Storage.
 *   3. Ensures the persistent agents (alice, bob, judge-athena) are registered.
 *   4. Mints one judge iNFT (idempotent).
 *   5. Replays past CaseFiled events that aren't yet Settled.
 *   6. Subscribes to new CaseFiled events.
 *
 * For each picked-up case it:
 *   - Decodes the accusation from the cid (data URI).
 *   - Accepts the case with the persistent judge panel (threshold = 1).
 *   - Runs the trial: openings → rebuttals → closings → judge ruling.
 *   - Posts the verdict via finalizeVerdict and marks settled.
 *   - Persists per-case event log to .events-<caseId>.jsonl for the UI.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as dotenv from "dotenv";
import { ethers, JsonRpcProvider, NonceManager, Wallet } from "ethers";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.env") });

import { createAxlClient, subscribe } from "./transport/axl.js";
import { pickLlmFromEnv, pickJudgeLlmFromEnv } from "./llm/index.js";
import { createTribunalClient } from "./chain/tribunal-client.js";
import { createClerk } from "./roles/clerk.js";
import { createLawyer } from "./roles/lawyer.js";
import { createJudge } from "./roles/judge.js";
import { createPartyAgent } from "./roles/party.js";
import { createZgStorage, type ZgStorage } from "./storage/og-storage.js";
import { fetchDocket, formatDocket } from "./case/docket.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface DeploymentJson {
  chains?: { ogGalileo?: { contracts: Record<string, string> } };
  legacy?: Record<string, string>;
  [k: string]: any;
}

interface ContractAddresses {
  AgentRegistry: string;
  TribunalCore: string;
  EscrowAdapter: string;
  VerdictLog: string;
  JudgeINFT: string;
  TribunalEscrow?: string;
}

function envOrThrow(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

function loadAddresses(): ContractAddresses {
  const p = path.resolve(__dirname, "../../docs/deployment.json");
  const j = JSON.parse(fs.readFileSync(p, "utf8")) as DeploymentJson;
  const c = j?.chains?.ogGalileo?.contracts ?? j?.legacy ?? j;
  return {
    AgentRegistry: c.AgentRegistry,
    TribunalCore:  c.TribunalCore,
    EscrowAdapter: c.EscrowAdapter,
    VerdictLog:    c.VerdictLog,
    JudgeINFT:     c.JudgeINFT,
    ...(c.TribunalEscrow ? { TribunalEscrow: c.TribunalEscrow } as { TribunalEscrow: string } : {}),
  };
}

function loadAbi(contractName: string): any[] {
  const p = path.resolve(
    __dirname,
    `../../contracts/artifacts/src/${contractName}.sol/${contractName}.json`,
  );
  return JSON.parse(fs.readFileSync(p, "utf8")).abi;
}

async function resolveEns(addr: string): Promise<string> {
  const url = process.env.TRIBUNAL_BACKEND_URL ?? "http://127.0.0.1:3000";
  try {
    const res = await fetch(`${url}/api/identity/resolve?address=${addr}`);
    if (!res.ok) return addr;
    const j = (await res.json()) as { ensName?: string };
    return j.ensName ?? addr;
  } catch { return addr; }
}

/// Fallback when OG_STORAGE_URL isn't set.
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

// Galileo Flow was upgraded to `submit(((length, bytes tags, nodes), address submitter))`
// (selector 0xbc8c11f8). The latest published 0g-ts-sdk (0.3.3) still emits the old
// `submit((length, bytes tags, nodes))` selector (0xef3e12dc), so every upload reverts.
// Patch Uploader.submitTransaction in place to wrap the submission with the new
// `submitter` field and call the new selector. Once 0G ships an SDK update this
// patch becomes a no-op and can be removed.
function patchSdkSubmitTransaction(sdk: any): void {
  if (sdk.Uploader.prototype.__tribunalSubmitPatched) return;
  const NEW_FLOW_ABI = [
    "function submit(((uint256 length, bytes tags, (bytes32 root, uint256 height)[] nodes) data, address submitter)) payable returns (uint256, bytes32, uint256, uint256)",
    "function market() view returns (address)",
  ];
  const MARKET_ABI = ["function pricePerSector() view returns (uint256)"];
  function calcFee(submission: any, pricePerSector: bigint): bigint {
    let sectors = 0n;
    for (const n of submission.nodes) sectors += 1n << BigInt(n.height.toString());
    return sectors * pricePerSector;
  }
  sdk.Uploader.prototype.submitTransaction = async function (this: any, submission: any, opts: any) {
    const flowAddress: string = await this.flow.getAddress();
    const signer = this.flow.runner;
    const submitter: string = signer.address ?? (await signer.getAddress());
    const flowNew = new ethers.Contract(flowAddress, NEW_FLOW_ABI, signer);
    const marketAddr: string = await flowNew.market();
    const marketContract = new ethers.Contract(marketAddr, MARKET_ABI, this.provider);
    const pricePerSector: bigint = await marketContract.pricePerSector();
    const fee = (opts?.fee && BigInt(opts.fee) > 0n) ? BigInt(opts.fee) : calcFee(submission, pricePerSector);
    let gasPrice: bigint = BigInt(this.gasPrice ?? 0);
    if (gasPrice === 0n) {
      const fee = await this.provider.getFeeData();
      if (!fee.gasPrice) return [null, new Error("no suggested gasPrice")];
      gasPrice = fee.gasPrice;
    }
    const txOpts: any = { value: fee, gasPrice };
    if (opts?.nonce !== undefined) txOpts.nonce = opts.nonce;
    if (this.gasLimit && BigInt(this.gasLimit) > 0n) txOpts.gasLimit = this.gasLimit;
    const wrapped = { data: submission, submitter };
    console.log("Submitting transaction with storage fee:", fee, "(patched ABI v2)");
    try {
      const tx = await flowNew.submit(wrapped, txOpts);
      const receipt = await tx.wait();
      return [receipt, null];
    } catch (e: any) {
      return [null, new Error("Failed to submit transaction: " + (e.message ?? e))];
    }
  };
  sdk.Uploader.prototype.__tribunalSubmitPatched = true;
}

async function buildStorage(rpcUrl: string, signer: unknown): Promise<{ storage: ZgStorage; kind: "0g" | "memory" }> {
  const indexerUrl = process.env.OG_STORAGE_URL;
  if (!indexerUrl) return { storage: inMemoryStorage(), kind: "memory" };
  const sdk: any = await import("@0glabs/0g-ts-sdk");
  patchSdkSubmitTransaction(sdk);
  const indexer = new sdk.Indexer(indexerUrl);
  const real = createZgStorage({
    indexer: indexer as any,
    memDataCtor: sdk.MemData as any,
    rpcUrl,
    signer,
  });
  // Verify the patched submit works against the live Flow contract before we
  // commit to using real storage. If anything still fails (e.g. 0G upgrades
  // again) fall back to in-memory so the trial pipeline keeps working.
  try {
    await real.upload(new TextEncoder().encode("tribunal-storage-probe"));
    return { storage: real, kind: "0g" };
  } catch (e) {
    console.warn("[storage] 0G upload probe failed, falling back to in-memory:", (e as Error).message?.slice(0, 200));
    return { storage: inMemoryStorage(), kind: "memory" };
  }
}

/// Decode an accusationCid that we wrote in the form `data:text/plain;base64,<text>`.
/// For other cid shapes, fall back to the raw string so judges/lawyers see *something*.
function decodeAccusationCid(cid: string): string {
  const prefix = "data:text/plain;base64,";
  if (cid.startsWith(prefix)) {
    return Buffer.from(cid.slice(prefix.length), "base64").toString("utf8");
  }
  return cid;
}


async function main() {
  const rpcUrl   = envOrThrow("OG_RPC_URL");
  const provider = new JsonRpcProvider(rpcUrl);

  // The trial pipeline fires multiple chain writes for the operator wallet
  // concurrently (per-event recordEvent anchors, 0G storage submits, the
  // final finalizeVerdict). Stock ethers fetches a fresh nonce per tx from
  // the RPC, which races: two in-flight populates read the same nonce, one
  // wins, the rest revert with `nonce already used` or `replacement fee
  // too low`. NonceManager allocates incrementing nonces locally so
  // concurrent sends from the same wallet get unique slots.
  const baseOperator = new Wallet(envOrThrow("OG_PRIVATE_KEY"), provider);
  // The judge agent on 0G was registered with a hardhat dev key during the
  // initial deploy; submitRuling + appendRulingMemory must be signed by
  // *that* key, not the operator. Default keeps the deployed wiring; can be
  // overridden via JUDGE_PRIVATE_KEY.
  const baseJudge = new Wallet(
    process.env.JUDGE_PRIVATE_KEY ?? "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
    provider,
  );

  const operatorNm = new NonceManager(baseOperator);
  // When JUDGE_PRIVATE_KEY resolves to the same address as OG_PRIVATE_KEY,
  // share the NonceManager so concurrent sends don't race on nonces.
  const judgeNm =
    baseJudge.address.toLowerCase() === baseOperator.address.toLowerCase()
      ? operatorNm
      : new NonceManager(baseJudge);

  const operator = operatorNm;
  const judgeWallet = judgeNm;
  console.log("Operator:", baseOperator.address);
  console.log("Judge:   ", baseJudge.address);

  const addr = loadAddresses();
  console.log("Loaded deployment:", addr.TribunalCore);

  const tribunalCore = new ethers.Contract(addr.TribunalCore, loadAbi("TribunalCore"), operator);
  const judgeINFT    = new ethers.Contract(addr.JudgeINFT,    loadAbi("JudgeINFT"),    operator);
  const verdictLog   = new ethers.Contract(addr.VerdictLog,   loadAbi("VerdictLog"),   operator);
  const tribunal = createTribunalClient({
    tribunalCore: tribunalCore as any,
    judgeINFT:    judgeINFT    as any,
    verdictLog:   verdictLog   as any,
  });
  // Judge-bound contract handles for submitRuling + appendRulingMemory.
  const tribunalCoreAsJudge = new ethers.Contract(addr.TribunalCore, loadAbi("TribunalCore"), judgeWallet);
  const judgeINFTAsJudge    = new ethers.Contract(addr.JudgeINFT,    loadAbi("JudgeINFT"),    judgeWallet);
  const tribunalForJudge = createTribunalClient({
    tribunalCore: tribunalCoreAsJudge as any,
    judgeINFT:    judgeINFTAsJudge    as any,
  });

  const picked = pickLlmFromEnv();
  console.log(`LLM lawyers: ${picked.provider} (${picked.model})`);
  const llm = picked.llm;
  const judgePicked = pickJudgeLlmFromEnv();
  if (judgePicked.provider !== picked.provider || judgePicked.model !== picked.model) {
    console.log(`LLM judge: ${judgePicked.provider} (${judgePicked.model})`);
  }
  const judgeLlm = judgePicked.llm;

  // AXL singletons.
  const axlBase = process.env.AXL_BASE_URL ?? "http://127.0.0.1";
  const clerkAxl   = createAxlClient({ baseUrl: `${axlBase}:${process.env.AXL_PORT_CLERK    ?? 9002}` });
  const lawyerAaxl = createAxlClient({ baseUrl: `${axlBase}:${process.env.AXL_PORT_LAWYER_A ?? 9012}` });
  const lawyerBaxl = createAxlClient({ baseUrl: `${axlBase}:${process.env.AXL_PORT_LAWYER_B ?? 9022}` });
  const judgeAxl   = createAxlClient({ baseUrl: `${axlBase}:${process.env.AXL_PORT_JUDGE    ?? 9032}` });
  const clerkPeer  = await clerkAxl.peerId();
  console.log("Clerk peer:", clerkPeer);

  // Storage.
  const { storage, kind: storageKind } = await buildStorage(rpcUrl, operator);
  console.log(`Storage backend: ${storageKind}`);

  const judgeAddress = baseJudge.address;
  console.log("Judge address:", judgeAddress);

  // Find the iNFT owned by the judge wallet; mint one if none exists. We
  // don't mint blindly on every restart — that would litter the contract
  // with new tokens and any token not owned by the judge wallet is useless
  // because appendRulingMemory checks ownerOf().
  let judgeTokenId: bigint | null = null;
  const inftNext = (await judgeINFT.nextId()) as bigint;
  for (let i = 1n; i < inftNext; i++) {
    const owner = await judgeINFT.ownerOf(i).catch(() => null);
    if (owner && (owner as string).toLowerCase() === baseJudge.address.toLowerCase()) {
      judgeTokenId = i;
      break;
    }
  }
  if (judgeTokenId === null) {
    const tx = await judgeINFTAsJudge.mint(
      baseJudge.address,
      ethers.id("encryptedPersona-textualist-v1"),
      "data:application/json,judge-athena.persona",
    );
    const rc = await tx.wait();
    const ev = rc!.logs
      .map((l: any) => { try { return judgeINFT.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "MetadataRootUpdated");
    judgeTokenId = ev!.args.tokenId as bigint;
    console.log(`Minted judge iNFT #${judgeTokenId} to ${baseJudge.address}`);
  } else {
    console.log(`Reusing judge iNFT #${judgeTokenId} (owned by ${baseJudge.address})`);
  }

  // ---- per-case driver ---------------------------------------------------
  const inFlight = new Set<string>();

  async function runCase(
    caseId: bigint,
    accuser: string,
    defendant: string,
    accusationCid: string,
  ): Promise<void> {
    const key = caseId.toString();
    if (inFlight.has(key)) return;
    inFlight.add(key);

    try {
      const status: bigint = await tribunalCore.caseStatus(caseId);
      // CaseStatus enum: None=0, Filed=1, Accepted=2, Arguments=3, Deliberation=4, Ruled=5, Settled=6
      if (status === 6n) { console.log(`Case ${key} already settled, skipping`); return; }

      console.log(`\n=========== Case ${key} (status=${status}) ===========`);

      const accuserEns   = await resolveEns(accuser);
      const defendantEns = await resolveEns(defendant);

      const accusationText = decodeAccusationCid(accusationCid);
      console.log(`Accusation: ${accusationText.slice(0, 120)}${accusationText.length > 120 ? "…" : ""}`);

      const backendUrl = process.env.TRIBUNAL_BACKEND_URL ?? "http://127.0.0.1:3000";
      const partyMode = (process.env.TRIBUNAL_PARTY_MODE ?? "human") as "human" | "auto";
      const qaTimeoutMs = Number(process.env.TRIBUNAL_QA_TIMEOUT_MS ?? 5 * 60 * 1000);
      const partyAddress = { accuser, defendant };

      async function loadDocketText(): Promise<string> {
        const items = await fetchDocket(backendUrl, key);
        return formatDocket(items);
      }
      let docketText = await loadDocketText();

      // Per-case event log (UI reads this) + sidecar metadata file written
      // once 0G upload + on-chain anchor finish for each event.
      const eventLogPath = path.resolve(__dirname, `../../.events-${key}.jsonl`);
      const eventMetaPath = path.resolve(__dirname, `../../.events-${key}.meta.jsonl`);
      fs.writeFileSync(eventLogPath, "");
      fs.writeFileSync(eventMetaPath, "");
      const clerk = createClerk({
        caseId,
        storage,
        tribunal,
        forward: (ev) => {
          console.log(`[clerk c${key}] seq ${ev.seq} ${ev.kind} from ${ev.from}`);
          fs.appendFileSync(eventLogPath, JSON.stringify(ev) + "\n");
        },
        onPersisted: (seq, info) => {
          fs.appendFileSync(eventMetaPath, JSON.stringify({ seq, ...info }) + "\n");
        },
      });
      const stopSubscribe = subscribe(clerkAxl, async (env) => {
        const meta = (env.payload as any)?.meta;
        if (meta && String(meta.caseId) !== key) return; // ignore other cases
        await clerk.handleIncoming(env);
      });

      // Accept with single-judge panel if still in Filed state. acceptCase
      // moves the case to Arguments (skipping the unused Accepted enum slot).
      if (status === 1n) {
        await tribunal.acceptCase(caseId, [judgeAddress], 1n);
        console.log(`Accepted case ${key}`);
      }

      const partyEns = { accuser: accuserEns, defendant: defendantEns };

      const accuserPartyAgent = createPartyAgent({
        side: "accuser",
        ensName: accuserEns,
        accusation: accusationText,
        llm,
        model: picked.model,
      });
      const defendantPartyAgent = createPartyAgent({
        side: "defendant",
        ensName: defendantEns,
        accusation: accusationText,
        llm,
        model: picked.model,
      });

      const lawyerA = createLawyer({
        side: "accuser",
        brief: accusationText,
        ensName: accuserEns,
        clientEns: accuserEns,
        opponentEns: defendantEns,
        partyEns,
        clerkPeerId: clerkPeer,
        caseId: key,
        llm,
        axl: lawyerAaxl,
        model: picked.model,
        partyAgent: accuserPartyAgent,
        getTranscript: () => clerk.render(),
        partyAddress,
        backendUrl,
        mode: partyMode,
        qaTimeoutMs,
        docketText,
      });
      const lawyerB = createLawyer({
        side: "defendant",
        brief:
          `You are defending against the following accusation:\n${accusationText}\n\n` +
          `Argue that the accusation is unfounded, the facts are misrepresented, ` +
          `or the requested remedy is disproportionate. Be concrete; do not concede.`,
        ensName: defendantEns,
        clientEns: defendantEns,
        opponentEns: accuserEns,
        partyEns,
        clerkPeerId: clerkPeer,
        caseId: key,
        llm,
        axl: lawyerBaxl,
        model: picked.model,
        partyAgent: defendantPartyAgent,
        getTranscript: () => clerk.render(),
        partyAddress,
        backendUrl,
        mode: partyMode,
        qaTimeoutMs,
        docketText,
      });
      const judge = createJudge({
        ensName: "judge-athena.tribunal.eth",
        caseId,
        tokenId: judgeTokenId!,
        personaPrompt:
          "You are a careful textualist judge. Rule on what was actually written and demonstrably true, not on what parties wished was true.",
        priorRulings: [],
        llm: judgeLlm,
        axl: judgeAxl,
        tribunal: tribunalForJudge,
        clerkPeerId: clerkPeer,
        model: judgePicked.model,
        partyEns,
        partyAgents: { accuser: accuserPartyAgent, defendant: defendantPartyAgent },
        getTranscript: () => clerk.render(),
        partyAddress,
        backendUrl,
        mode: partyMode,
        qaTimeoutMs,
        docketText,
      });

      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

      console.log("--- discovery interviews ---");
      await lawyerA.interview();
      await wait(400);
      await lawyerB.interview();
      await wait(400);

      console.log("--- opening statements ---");
      const openA = await lawyerA.openingStatement();
      await wait(400);
      const openB = await lawyerB.openingStatement();
      await wait(400);

      console.log("--- cross-examination ---");
      await lawyerA.crossExamine();
      await wait(400);
      await lawyerB.crossExamine();
      await wait(400);

      console.log("--- rebuttals ---");
      await lawyerA.rebuttal(openB);
      await wait(400);
      await lawyerB.rebuttal(openA);
      await wait(400);

      console.log("--- closings ---");
      const transcriptText = clerk.render();
      await lawyerA.closingStatement(transcriptText);
      await wait(400);
      await lawyerB.closingStatement(transcriptText);
      await wait(800);

      // Re-load docket so the judge sees any late-uploaded evidence. Note:
      // lawyer/judge factories captured docketText at construction — the
      // judge here still sees the snapshot from trial start. Acceptable for
      // hackathon scope; a full fix recreates the judge factory here with
      // fresh docket text.
      docketText = await loadDocketText();

      console.log("--- judge clarifying question ---");
      const judgeAsked = await judge.clarifyingQuestion(clerk.render());
      if (judgeAsked) console.log(`(judge posed a clarifying question)`);

      console.log("--- judge deliberation ---");
      const ruling = await judge.deliberateAndRule(clerk.render());
      console.log("Verdict:", ruling.prevailingIsAccuser ? "for accuser" : "for defendant");

      const opinionRoot = ethers.keccak256(ethers.toUtf8Bytes(ruling.opinion)) as `0x${string}`;
      const finalize = ruling.receipt
        ? await tribunal.finalizeVerdictWithReceipt(caseId, addr.VerdictLog, opinionRoot, ruling.receipt)
        : await tribunal.finalizeVerdict(caseId, addr.VerdictLog, opinionRoot);
      if (ruling.receipt) {
        console.log(`Posted verdict + settled case ${key} (tx ${finalize.txHash}, REE receipt ${ruling.receipt.hash.slice(0, 10)}…)`);
      } else {
        console.log(`Posted verdict + settled case ${key} (tx ${finalize.txHash})`);
      }
      const verdictMetaPath = path.resolve(__dirname, `../../.verdict-${key}.json`);
      fs.writeFileSync(verdictMetaPath, JSON.stringify({
        finalizeTxHash: finalize.txHash,
        opinionRoot,
        prevailingIsAccuser: ruling.prevailingIsAccuser,
        receiptHash: ruling.receipt?.hash,
        receiptUrl: ruling.receipt?.url,
      }) + "\n");

      // Auto-settle the linked TribunalEscrow (if any) so funds move on the
      // same trial run. The settle call is permissionless on-chain — anyone
      // can poke it — so this is just a convenience.
      if (addr.TribunalEscrow) {
        try {
          const escAdapter = (await tribunalCore.caseEscrowAdapter(caseId)) as string;
          const escId      = (await tribunalCore.caseEscrowId(caseId))      as bigint;
          if (escAdapter && escAdapter.toLowerCase() === addr.TribunalEscrow.toLowerCase() && escId !== 0n) {
            const escAbi = ["function settleByTribunal(uint256 agreementId, uint256 caseId)"];
            const escContract = new ethers.Contract(addr.TribunalEscrow, escAbi, operator);
            const tx = await escContract.settleByTribunal(escId, caseId);
            const rc = await tx.wait();
            console.log(`[escrow c${key}] settled agreement ${escId} (tx ${rc!.hash})`);
          }
        } catch (e) {
          console.warn(`[escrow c${key}] auto-settle failed (non-fatal):`, (e as Error).message?.slice(0, 200));
        }
      }

      stopSubscribe();
    } catch (e) {
      console.error(`Case ${key} failed:`, e);
    } finally {
      inFlight.delete(key);
    }
  }

  // Serial queue so multiple filed cases don't trample each other on the
  // shared AXL nodes.
  const pending: { caseId: bigint; accuser: string; defendant: string; accusationCid: string }[] = [];
  let draining = false;
  async function drain() {
    if (draining) return;
    draining = true;
    while (pending.length > 0) {
      const next = pending.shift()!;
      await runCase(next.caseId, next.accuser, next.defendant, next.accusationCid);
    }
    draining = false;
  }
  function enqueue(c: bigint, a: string, d: string, cid: string) {
    if (inFlight.has(c.toString()) || pending.some((p) => p.caseId === c)) return;
    pending.push({ caseId: c, accuser: a, defendant: d, accusationCid: cid });
    drain().catch((e) => console.error("drain error:", e));
  }

  // Replay historical CaseFiled events (last ~5000 blocks) for unsettled cases.
  const filedEvent = tribunalCore.getEvent("CaseFiled");
  const head = await provider.getBlockNumber();
  const fromBlock = Math.max(0, head - 5000);
  console.log(`Replaying CaseFiled from block ${fromBlock} to ${head}…`);
  const past = await tribunalCore.queryFilter(filedEvent, fromBlock, head);
  for (const ev of past) {
    // Use positional access — ABI param names changed across versions and
    // ev.args.accuser / accuserId can disagree on replay.
    const args = (ev as any).args as any[];
    enqueue(args[0] as bigint, args[1] as string, args[2] as string, args[5] as string);
  }

  // Subscribe to new ones.
  await tribunalCore.on(filedEvent, (caseId, accuser, defendant, _escrow, _escrowId, accusationCid, _fee) => {
    console.log(`[event] CaseFiled #${caseId}`);
    enqueue(caseId as bigint, accuser as string, defendant as string, accusationCid as string);
  });

  console.log("Runner ready. Waiting for CaseFiled events…");
  // Stay alive.
  await new Promise(() => {});
}

main().catch((e) => { console.error(e); process.exit(1); });
