// mcp/src/tools.ts
import type { CallToolRequest } from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "./config.js";

export const toolDefinitions = [
  {
    name: "tribunal_resolve",
    description: "Resolve an Ethereum address or *.tribunal.eth name to {address, ensName}.",
    inputSchema: {
      type: "object",
      properties: { addressOrName: { type: "string" } },
      required: ["addressOrName"],
    },
  },
  {
    name: "tribunal_whoami",
    description: "Returns the agent's address and ENS subname under tribunal.eth (auto-published on first call).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "tribunal_file_case",
    description: "Signs and broadcasts TribunalCore.fileCase. defendant accepts an address or *.tribunal.eth name. Includes the BASE_FEE.",
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
    description: "Fetch case state, parties, events.",
    inputSchema: { type: "object", properties: { caseId: { type: "string" } }, required: ["caseId"] },
  },
  {
    name: "tribunal_list_cases",
    description: "List cases with optional filters.",
    inputSchema: { type: "object", properties: { party: { type: "string" }, status: { type: "string" } } },
  },
  {
    name: "tribunal_get_verdict",
    description: "Fetch ruling and reasoning for a settled case.",
    inputSchema: { type: "object", properties: { caseId: { type: "string" } }, required: ["caseId"] },
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

  throw new Error(`Unknown tool: ${name}`);
}
