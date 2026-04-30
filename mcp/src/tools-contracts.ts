import { ethers } from "ethers";

const ESCROW_ABI = [
  "function nextId() view returns (uint256)",
  "function proposeAgreement(address payer, address payee, uint256 amount, uint64 deadline, string termsCid) returns (uint256)",
  "function acceptAgreement(uint256 id)",
  "function revokeProposal(uint256 id)",
  "function fundAgreement(uint256 id) payable",
  "function releasePayment(uint256 id)",
  "function claimAfterDeadline(uint256 id)",
  "function finalizeClaim(uint256 id)",
  "function settleByTribunal(uint256 agreementId, uint256 caseId)",
  "function getAgreement(uint256 id) view returns (address payer, address payee, address proposer, uint256 amount, uint64 deadline, uint64 claimedAt, uint8 status, string termsCid)",
  "event AgreementProposed(uint256 indexed id, address indexed proposer, address indexed payer, address payee, uint256 amount, uint64 deadline, string termsCid)",
];

const TRIBUNAL_ABI_FILE_CASE = [
  "function fileCase(address defendant, address escrowAdapter, uint256 escrowId, string accusationCid) payable returns (uint256)",
  "function BASE_FEE() view returns (uint256)",
];

const STATUS_LABELS = ["Proposed", "Accepted", "Funded", "Claimed", "Released", "Disputed", "Settled", "Revoked"];

export interface ContractsCtx {
  backendUrl: string;
  walletAddress: string;
  /// Resolves a *.tribunal.eth or 0x to checksummed 0x via /api/identity/resolve.
  resolveAddress(input: string): Promise<string>;
  /// Provider + signer for sending txs. Pass in pre-built so tests can inject a mock.
  signer: ethers.Signer;
  provider: ethers.Provider;
  escrowAddress: string;
  tribunalCoreAddress: string;
  explorerBase: string; // e.g. "https://chainscan-galileo.0g.ai"
}

function escrowR(ctx: ContractsCtx) {
  return new ethers.Contract(ctx.escrowAddress, ESCROW_ABI, ctx.provider);
}
function escrowW(ctx: ContractsCtx) {
  return new ethers.Contract(ctx.escrowAddress, ESCROW_ABI, ctx.signer);
}

interface AgreementView {
  id: string;
  payer: string;
  payee: string;
  proposer: string;
  amount: string; // wei string
  amountOg: string; // human-readable OG
  deadline: number; // unix seconds
  deadlineISO: string;
  claimedAt: number;
  status: number;
  statusLabel: string;
  termsCid: string;
}

async function readAgreement(ctx: ContractsCtx, id: string): Promise<AgreementView> {
  const r = await escrowR(ctx).getAgreement(id);
  const status = Number(r[6]);
  const deadline = Number(r[4]);
  const claimedAt = Number(r[5]);
  return {
    id,
    payer: r[0] as string,
    payee: r[1] as string,
    proposer: r[2] as string,
    amount: (r[3] as bigint).toString(),
    amountOg: ethers.formatEther(r[3] as bigint),
    deadline,
    deadlineISO: new Date(deadline * 1000).toISOString(),
    claimedAt,
    status,
    statusLabel: STATUS_LABELS[status] ?? `unknown(${status})`,
    termsCid: r[7] as string,
  };
}

function nextActions(view: AgreementView, walletAddress: string): string[] {
  const me = walletAddress.toLowerCase();
  const isPayer = view.payer.toLowerCase() === me;
  const isPayee = view.payee.toLowerCase() === me;
  const isProposer = view.proposer.toLowerCase() === me;
  const a: string[] = [];
  switch (view.status) {
    case 0: // Proposed
      if (isProposer) a.push(`You proposed this contract. Waiting on the other party (${isPayer ? view.payee : view.payer}) to accept. You can call tribunal_revoke_contract({contractId:"${view.id}"}) to cancel.`);
      else if (isPayer || isPayee) {
        a.push(`READ THE TERMS in 'termsCid' carefully and confirm them with the user verbatim.`);
        a.push(`If the user agrees, call tribunal_accept_contract({contractId:"${view.id}"}). Acceptance is binding — after that the payer can fund.`);
        a.push(`If the terms are wrong, do NOT accept. Tell the user; the proposer can revoke and re-propose.`);
      } else a.push(`Awaiting acceptance by ${isPayer ? view.payee : view.payer}.`);
      break;
    case 1: // Accepted
      if (isPayer) a.push(`Both parties have agreed. Lock the funds: call tribunal_fund_contract({contractId:"${view.id}"}). It will send ${view.amountOg} OG into escrow.`);
      else a.push(`Both accepted. Waiting on payer ${view.payer} to call tribunal_fund_contract.`);
      break;
    case 2: // Funded
      if (isPayer) a.push(`Funds locked. When work is complete and you're satisfied, call tribunal_release_payment({contractId:"${view.id}"}) to pay the payee. If you're unhappy, call tribunal_dispute_contract.`);
      else if (isPayee) a.push(`Funds are locked. After deadline ${view.deadlineISO} you may call tribunal_claim_contract; payer has 24h to dispute. If you have evidence the work is complete and the payer is stalling, you can also dispute now via tribunal_dispute_contract.`);
      else a.push(`Funded. Awaiting release, claim, or dispute.`);
      break;
    case 3: // Claimed
      a.push(`Payee has claimed; 24h dispute window is running. If you're the payer and disagree, call tribunal_dispute_contract NOW. Otherwise, anyone may call tribunal_finalize_claim after the window expires to release funds to payee.`);
      break;
    case 4: // Released
      a.push(`Closed (released to payee). No further action.`);
      break;
    case 5: // Disputed
      a.push(`Tribunal case is in flight. Run tribunal_inbox + tribunal_wait_for_action to follow the trial. The runner auto-settles this escrow once verdict drops.`);
      break;
    case 6: // Settled
      a.push(`Settled by Tribunal verdict. Check the linked case verdict via tribunal_get_verdict for context.`);
      break;
    case 7: // Revoked
      a.push(`Revoked by proposer. Closed. Re-propose if you still want a contract.`);
      break;
  }
  return a;
}

function wrap(
  view: AgreementView | null,
  ctxAddress: string,
  extra?: Record<string, unknown>,
): string {
  if (!view) return JSON.stringify({ result: null, ...(extra ?? {}) });
  return JSON.stringify({
    result: { ...view, ...(extra ?? {}) },
    nextActions: nextActions(view, ctxAddress),
  });
}

/// Helper: parse human-friendly amount ("0.5", "1") and deadline ("in 7 days", ISO).
function parseAmountOg(input: string): bigint {
  if (!input) throw new Error("amount required");
  // Allow "0.5", "1.0", "1 OG", "1.0 OG".
  const m = input.trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*(?:og)?$/i);
  if (!m) throw new Error(`bad amount: ${input}`);
  return ethers.parseEther(m[1]);
}

function parseDeadline(input: string | number): number {
  if (typeof input === "number") return input;
  const n = Number(input);
  if (Number.isFinite(n) && n > 1_000_000_000) return n; // seconds since epoch
  // "in N days" / "in N hours"
  const m = input
    .toLowerCase()
    .trim()
    .match(/^in\s+(\d+)\s+(day|days|hour|hours|minute|minutes)$/);
  if (m) {
    const n2 = Number(m[1]);
    const unit = m[2].startsWith("day") ? 86400 : m[2].startsWith("hour") ? 3600 : 60;
    return Math.floor(Date.now() / 1000) + n2 * unit;
  }
  const ts = Date.parse(input);
  if (!Number.isNaN(ts)) return Math.floor(ts / 1000);
  throw new Error(`bad deadline: ${input}`);
}

export async function handleProposeContract(
  ctx: ContractsCtx,
  args: {
    payerInput: string;
    payeeInput?: string;
    amount: string;
    deadline: string;
    terms: string;
  },
): Promise<string> {
  const payer = await ctx.resolveAddress(args.payerInput);
  const payee = args.payeeInput
    ? await ctx.resolveAddress(args.payeeInput)
    : ctx.walletAddress;
  const amountWei = parseAmountOg(args.amount);
  const deadline = parseDeadline(args.deadline);
  const tx = await escrowW(ctx).proposeAgreement(payer, payee, amountWei, deadline, args.terms);
  const receipt = await tx.wait();
  const iface = new ethers.Interface(ESCROW_ABI);
  const ev = receipt!.logs
    .map((l: any) => {
      try {
        return iface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((e: any) => e?.name === "AgreementProposed");
  if (!ev) throw new Error("AgreementProposed event missing");
  const id = (ev.args.id as bigint).toString();
  const view = await readAgreement(ctx, id);
  return wrap(view, ctx.walletAddress, {
    txHash: receipt!.hash,
    explorerUrl: `${ctx.explorerBase}/tx/${receipt!.hash}`,
  });
}

export async function handleAcceptContract(ctx: ContractsCtx, args: { contractId: string }): Promise<string> {
  const tx = await escrowW(ctx).acceptAgreement(args.contractId);
  const receipt = await tx.wait();
  const updated = await readAgreement(ctx, args.contractId);
  return wrap(updated, ctx.walletAddress, {
    txHash: receipt!.hash, explorerUrl: `${ctx.explorerBase}/tx/${receipt!.hash}`,
  });
}

export async function handleRevokeContract(ctx: ContractsCtx, args: { contractId: string }): Promise<string> {
  const tx = await escrowW(ctx).revokeProposal(args.contractId);
  const receipt = await tx.wait();
  const updated = await readAgreement(ctx, args.contractId);
  return wrap(updated, ctx.walletAddress, {
    txHash: receipt!.hash, explorerUrl: `${ctx.explorerBase}/tx/${receipt!.hash}`,
  });
}

export async function handleFundContract(
  ctx: ContractsCtx,
  args: { contractId: string },
): Promise<string> {
  const view = await readAgreement(ctx, args.contractId);
  const tx = await escrowW(ctx).fundAgreement(args.contractId, {
    value: BigInt(view.amount),
  });
  const receipt = await tx.wait();
  const updated = await readAgreement(ctx, args.contractId);
  return wrap(updated, ctx.walletAddress, {
    txHash: receipt!.hash,
    explorerUrl: `${ctx.explorerBase}/tx/${receipt!.hash}`,
  });
}

export async function handleReleasePayment(
  ctx: ContractsCtx,
  args: { contractId: string },
): Promise<string> {
  const tx = await escrowW(ctx).releasePayment(args.contractId);
  const receipt = await tx.wait();
  const updated = await readAgreement(ctx, args.contractId);
  return wrap(updated, ctx.walletAddress, {
    txHash: receipt!.hash,
    explorerUrl: `${ctx.explorerBase}/tx/${receipt!.hash}`,
  });
}

export async function handleClaimContract(
  ctx: ContractsCtx,
  args: { contractId: string },
): Promise<string> {
  const tx = await escrowW(ctx).claimAfterDeadline(args.contractId);
  const receipt = await tx.wait();
  const updated = await readAgreement(ctx, args.contractId);
  return wrap(updated, ctx.walletAddress, {
    txHash: receipt!.hash,
    explorerUrl: `${ctx.explorerBase}/tx/${receipt!.hash}`,
  });
}

export async function handleFinalizeClaim(
  ctx: ContractsCtx,
  args: { contractId: string },
): Promise<string> {
  const tx = await escrowW(ctx).finalizeClaim(args.contractId);
  const receipt = await tx.wait();
  const updated = await readAgreement(ctx, args.contractId);
  return wrap(updated, ctx.walletAddress, {
    txHash: receipt!.hash,
    explorerUrl: `${ctx.explorerBase}/tx/${receipt!.hash}`,
  });
}

export async function handleDisputeContract(
  ctx: ContractsCtx,
  args: { contractId: string; accusation: string },
): Promise<string> {
  const view = await readAgreement(ctx, args.contractId);
  const me = ctx.walletAddress.toLowerCase();
  let defendant: string;
  if (view.payer.toLowerCase() === me) defendant = view.payee;
  else if (view.payee.toLowerCase() === me) defendant = view.payer;
  else throw new Error("only payer or payee may dispute");
  const tribunal = new ethers.Contract(
    ctx.tribunalCoreAddress,
    TRIBUNAL_ABI_FILE_CASE,
    ctx.signer,
  );
  const baseFee = (await tribunal.BASE_FEE()) as bigint;
  const accusationCid = `data:text/plain;base64,${Buffer.from(args.accusation, "utf8").toString("base64")}`;
  const tx = await tribunal.fileCase(
    defendant,
    ctx.escrowAddress,
    args.contractId,
    accusationCid,
    { value: baseFee },
  );
  const receipt = await tx.wait();
  // Parse caseId from CaseFiled event
  const iface = new ethers.Interface([
    "event CaseFiled(uint256 indexed caseId, address indexed accuser, address indexed defendant, address escrowAdapter, uint256 escrowId, string accusationCid, uint256 fee)",
  ]);
  const ev = receipt!.logs
    .map((l: any) => {
      try {
        return iface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((e: any) => e?.name === "CaseFiled");
  const caseId = ev ? (ev.args.caseId as bigint).toString() : null;
  const updated = await readAgreement(ctx, args.contractId);
  return wrap(updated, ctx.walletAddress, {
    txHash: receipt!.hash,
    explorerUrl: `${ctx.explorerBase}/tx/${receipt!.hash}`,
    caseId,
  });
}

export async function handleGetContract(
  ctx: ContractsCtx,
  args: { contractId: string },
): Promise<string> {
  const view = await readAgreement(ctx, args.contractId);
  return wrap(view, ctx.walletAddress);
}

export async function handleListMyContracts(ctx: ContractsCtx): Promise<string> {
  const next = (await escrowR(ctx).nextId()) as bigint;
  const out: AgreementView[] = [];
  for (let i = 1n; i < next; i++) {
    const view = await readAgreement(ctx, i.toString());
    const me = ctx.walletAddress.toLowerCase();
    if (
      view.payer.toLowerCase() === me ||
      view.payee.toLowerCase() === me
    ) {
      out.push(view);
    }
  }
  return JSON.stringify({
    result: out,
    summary: `${out.length} contract(s) you're involved in. For any in status Proposed/Accepted/Funded/Claimed, see nextActions on the individual contract via tribunal_get_contract.`,
  });
}
