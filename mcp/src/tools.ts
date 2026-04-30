// mcp/src/tools.ts
import type { CallToolRequest } from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "./config.js";

export const toolDefinitions = [
  {
    name: "tribunal_resolve",
    description: "Resolve a 0x address ↔ *.tribunal.eth ENS name. Use BEFORE filing a case so you can confirm with the user that the defendant is who they think it is.",
    inputSchema: {
      type: "object",
      properties: { addressOrName: { type: "string" } },
      required: ["addressOrName"],
    },
  },
  {
    name: "tribunal_whoami",
    description: "Returns this agent's address + ENS subname under tribunal.eth (auto-published on first call). Call once at session start so the user knows which Tribunal identity they're speaking through.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "tribunal_file_case",
    description: "Step 1 of 4. Files a dispute on the Tribunal AI court (signs + broadcasts TribunalCore.fileCase, includes BASE_FEE). \n\n⚠️ CRITICAL — judges and lawyers in this court are FORBIDDEN from inventing facts. A filing with no evidence on the docket WILL LOSE. Before calling this tool, ask the user for concrete proof sources (emails, transaction hashes, contract clauses, screenshots, calendar invites). Use any connected MCP (Gmail, Drive, Calendar, blockchain explorer) to retrieve them.\n\nAfter filing: (a) call tribunal_submit_evidence for EACH artifact, (b) sit in tribunal_wait_for_action to handle questions from the lawyer/judge, (c) surface the verdict when it returns. defendant accepts an address or *.tribunal.eth name.",
    inputSchema: {
      type: "object",
      properties: {
        defendant:  { type: "string" },
        accusation: { type: "string" },
        escrow:     { type: "string", description: "Optional escrow contract address. Default zero address." },
        escrowId:   { type: "string", description: "Optional escrow id (uint256). Default 0." },
      },
      required: ["defendant", "accusation"],
    },
  },
  {
    name: "tribunal_get_case",
    description: "Read-only snapshot of a case (state + parties + events). Use to debug or to brief the user on where things stand. For agentic monitoring, prefer tribunal_wait_for_action which long-polls and returns the moment something actionable happens.",
    inputSchema: { type: "object", properties: { caseId: { type: "string" } }, required: ["caseId"] },
  },
  {
    name: "tribunal_list_cases",
    description: "List cases (filter by party / status). For \"what's open for me?\" prefer tribunal_inbox — it's scoped to your address.",
    inputSchema: { type: "object", properties: { party: { type: "string" }, status: { type: "string" } } },
  },
  {
    name: "tribunal_get_verdict",
    description: "Final ruling for a settled case. The opinion will cite evd_ ids referencing the docket. After fetching, surface the ruling AND the cited evidence to the user so they understand WHY the judge ruled as they did.",
    inputSchema: { type: "object", properties: { caseId: { type: "string" } }, required: ["caseId"] },
  },
  {
    name: "tribunal_submit_evidence",
    description: "Step 2 of 4. Append an evidence item (a fact, a tx hash, a date, a contract clause, a screenshot rendered as text, an email body) to the case docket. Only items in the docket are admissible — anything you don't add here CANNOT be cited by the lawyer or judge. \n\nIf you don't have evidence handy, ASK THE USER where to source it (gmail / drive / calendar / blockchain explorer / message history) and pull it via the appropriate MCP. Submit each artifact as a separate call. The optional `url` field should be a deep-link the user could click to verify (gmail thread URL, etherscan tx URL, etc.). Returns docketItemCount + nextActions guidance.",
    inputSchema: {
      type: "object",
      properties: {
        caseId: { type: "string" },
        body:   { type: "string", description: "Plain-text evidence: facts, dates, names, contract clauses, etc." },
        url:    { type: "string", description: "Optional supporting link (tx explorer, git commit, screenshot URL)." },
      },
      required: ["caseId", "body"],
    },
  },
  {
    name: "tribunal_get_docket",
    description: "View the full evidence record for a case. Useful before submitting more evidence so you don't duplicate items, and useful for surfacing a summary to the user. Both parties' submissions are visible.",
    inputSchema: { type: "object", properties: { caseId: { type: "string" } }, required: ["caseId"] },
  },
  {
    name: "tribunal_answer_question",
    description: "Answer a pending question posed by a lawyer or judge during the trial. PROCESS: (1) gather facts FIRST — search the user's connected MCPs (Gmail, Drive, Calendar, etc.) for supporting data; ask the user for guidance if multiple sources are plausible. (2) Call tribunal_submit_evidence for each artifact you find so the lawyer/judge can cite it durably. (3) Answer here with prose that REFERENCES the evd_ ids you just submitted (e.g. \"Per [evd_5_a3f] — the email dated 2026-04-12 — payment was due on delivery and remains unpaid.\"). \n\nIf after searching you still cannot produce evidence, answer literally: \"I cannot produce evidence on this point.\" NEVER fabricate. After answering, immediately call tribunal_wait_for_action to handle the next question or the verdict.",
    inputSchema: {
      type: "object",
      properties: {
        caseId:     { type: "string" },
        questionId: { type: "string" },
        answer:     { type: "string" },
      },
      required: ["caseId", "questionId", "answer"],
    },
  },
  {
    name: "tribunal_inbox",
    description: "List open cases involving this agent + pending questions awaiting your answer. If a case has been filed AGAINST you, treat it as urgent — the trial proceeds with or without your input. To rebut, call tribunal_submit_evidence with counter-evidence (proof of payment, delivery confirmation, contract terms) BEFORE the lawyer asks; questions reference the docket, not your imagination. Then sit in tribunal_wait_for_action for the trial loop.",
    inputSchema: {
      type: "object",
      properties: { role: { type: "string", enum: ["accuser", "defendant", "any"] } },
    },
  },
  {
    name: "tribunal_my_cases",
    description: "Alias for tribunal_inbox with role=any. Lists every active case you're involved in.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "tribunal_wait_for_action",
    description:
      `Step 3 of 4 — the AGENTIC LOOP primitive. Long-polls (default ~5 min, configurable via timeoutMs) and returns the MOMENT the case needs your attention: a lawyer or judge has asked you a question, the verdict has dropped, or the call timed out idle. ` +
      `Use this in a loop after submitting evidence: call → handle event → call again. Returns one of:\n` +
      `  {event:"question", questionId, body, askedBy, target}  — go fetch supporting data, submit evidence, then call tribunal_answer_question.\n` +
      `  {event:"verdict-ready", status}  — call tribunal_get_verdict and surface the ruling.\n` +
      `  {event:"idle", now, status}  — nothing happened in the window; call again.\n` +
      `Keep calling until you see verdict-ready. Pass the previous response's "now" as sinceMs to avoid re-receiving the same question.`,
    inputSchema: {
      type: "object",
      properties: {
        caseId:    { type: "string" },
        sinceMs:   { type: "number", description: "Last seen timestamp from the previous wait_for_action response. Omit on first call." },
        timeoutMs: { type: "number", description: "Max wait in ms. Server caps at 9 min. Default 5 min." },
      },
      required: ["caseId"],
    },
  },
] as const;

export async function registerTools(req: CallToolRequest): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const { name, arguments: args } = req.params;
  const cfg = loadConfig();

  if (name === "tribunal_resolve") {
    const input = (args as any).addressOrName as string;
    const url = /^0x[0-9a-fA-F]{40}$/.test(input)
      ? `${cfg.backendUrl}/api/identity/resolve?address=${input}`
      : `${cfg.backendUrl}/api/identity/resolve?name=${encodeURIComponent(input)}`;
    const res = await fetch(url);
    const j = await res.json();
    return { content: [{ type: "text", text: JSON.stringify(j) }] };
  }

  if (name === "tribunal_whoami") {
    const { createChainContext } = await import("./signer.js");
    const ctx = createChainContext(cfg);
    const nonce = Math.random().toString(36).slice(2);
    const message =
      `tribunal-auth\n` +
      `address: ${ctx.wallet.address.toLowerCase()}\n` +
      `nonce: ${nonce}\n` +
      `issued-at: ${new Date().toISOString()}`;
    const signature = await ctx.wallet.signMessage(message);
    const res = await fetch(`${cfg.backendUrl}/api/identity/whoami`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: ctx.wallet.address, message, signature }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`whoami failed: ${res.status} ${t}`);
    }
    const j = await res.json();
    return { content: [{ type: "text", text: JSON.stringify(j) }] };
  }

  if (name === "tribunal_file_case") {
    const { ethers } = await import("ethers");
    const { createChainContext } = await import("./signer.js");
    const ctx = createChainContext(cfg);

    const a = args as any;
    const defendantInput = a.defendant as string;
    let defendant: string;
    if (/^0x[0-9a-fA-F]{40}$/.test(defendantInput)) {
      defendant = ethers.getAddress(defendantInput);
    } else {
      const r = await fetch(`${cfg.backendUrl}/api/identity/resolve?name=${encodeURIComponent(defendantInput)}`);
      const j = (await r.json()) as { address?: string | null };
      if (!j.address) throw new Error(`cannot resolve ${defendantInput}; pass an address instead`);
      defendant = ethers.getAddress(j.address);
    }
    const escrow   = a.escrow   ? ethers.getAddress(a.escrow as string) : ethers.ZeroAddress;
    const escrowId = a.escrowId ? BigInt(a.escrowId as string) : 0n;
    const accusationCid = `data:text/plain;base64,${Buffer.from(a.accusation as string, "utf8").toString("base64")}`;

    const TRIBUNAL_ABI = [
      "function fileCase(address defendant, address escrowAdapter, uint256 escrowId, string accusationCid) payable returns (uint256)",
      "function BASE_FEE() view returns (uint256)",
    ];
    const tribunal = new ethers.Contract(ctx.contracts.TribunalCore, TRIBUNAL_ABI, ctx.wallet);
    const baseFee  = (await tribunal.BASE_FEE()) as bigint;

    const populated = await tribunal.fileCase.populateTransaction(defendant, escrow, escrowId, accusationCid, { value: baseFee });
    (populated as any).from = undefined;
    const nonce = await ctx.provider.getTransactionCount(ctx.wallet.address);
    const fee   = await ctx.provider.getFeeData();
    const network = await ctx.provider.getNetwork();
    const signed = await ctx.wallet.signTransaction({
      ...populated,
      chainId: network.chainId,
      nonce,
      type: 2,
      maxFeePerGas: fee.maxFeePerGas ?? fee.gasPrice ?? 1n,
      maxPriorityFeePerGas: fee.maxPriorityFeePerGas ?? fee.gasPrice ?? 1n,
      gasLimit: 500_000n,
    });

    const res = await fetch(`${cfg.backendUrl}/api/cases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rawTx: signed }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`relay failed: ${res.status} ${text}`);

    // Wrap the relay response with phase + nextActions so the host agent
    // knows to immediately gather evidence + sit in wait_for_action.
    let parsed: any;
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
    if (parsed?.caseId) {
      const { createChainContext } = await import("./signer.js");
      const sCtx = createChainContext(cfg);
      const { withGuidance } = await import("./tools-evidence.js");
      const wrapped = await withGuidance(
        { backendUrl: cfg.backendUrl, walletAddress: sCtx.wallet.address, signMessage: (m: string) => sCtx.wallet.signMessage(m) },
        String(parsed.caseId),
        parsed,
      );
      return { content: [{ type: "text", text: wrapped }] };
    }
    return { content: [{ type: "text", text }] };
  }

  if (name === "tribunal_get_case") {
    const id = (args as any).caseId as string;
    const r = await fetch(`${cfg.backendUrl}/api/cases/${encodeURIComponent(id)}`);
    return { content: [{ type: "text", text: await r.text() }] };
  }
  if (name === "tribunal_list_cases") {
    const a = args as any;
    const u = new URL(`${cfg.backendUrl}/api/cases`);
    if (a.party)  u.searchParams.set("party",  a.party);
    if (a.status) u.searchParams.set("status", a.status);
    const r = await fetch(u);
    return { content: [{ type: "text", text: await r.text() }] };
  }
  if (name === "tribunal_get_verdict") {
    const id = (args as any).caseId as string;
    const r = await fetch(`${cfg.backendUrl}/api/cases/${encodeURIComponent(id)}/verdict`);
    return { content: [{ type: "text", text: await r.text() }] };
  }

  if (
    name === "tribunal_submit_evidence" ||
    name === "tribunal_get_docket" ||
    name === "tribunal_answer_question" ||
    name === "tribunal_inbox" ||
    name === "tribunal_my_cases" ||
    name === "tribunal_wait_for_action"
  ) {
    const { createChainContext } = await import("./signer.js");
    const ctx = createChainContext(cfg);
    const ev = await import("./tools-evidence.js");
    const evidenceCtx = {
      backendUrl: cfg.backendUrl,
      walletAddress: ctx.wallet.address,
      signMessage: (m: string) => ctx.wallet.signMessage(m),
    };
    let text: string;
    if (name === "tribunal_submit_evidence")
      text = await ev.handleSubmitEvidence(evidenceCtx, args as any);
    else if (name === "tribunal_get_docket")
      text = await ev.handleGetDocket(evidenceCtx, args as any);
    else if (name === "tribunal_answer_question")
      text = await ev.handleAnswerQuestion(evidenceCtx, args as any);
    else if (name === "tribunal_inbox")
      text = await ev.handleInbox(evidenceCtx, (args ?? {}) as any);
    else if (name === "tribunal_wait_for_action")
      text = await ev.handleWaitForAction(evidenceCtx, args as any);
    else
      text = await ev.handleMyCases(evidenceCtx);
    return { content: [{ type: "text", text }] };
  }

  throw new Error(`Unknown tool: ${name}`);
}
