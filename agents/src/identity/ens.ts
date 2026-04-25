// ENS + ENSIP-25 identity helpers.
//
// ENSIP-25 ("Verifiable AI Agent Identity") links an ENS name to an entry in
// an on-chain agent registry (e.g. ERC-8004) via a deterministic text record.
// Spec: https://ens.domains/blog/post/ensip-25
//
// We construct the record key from the registry's interoperable address
// (ERC-7930, e.g. "eip155:80087:0x...") and the agent's id. Value "1" asserts
// verified association.

export type AgentRole = "judge" | "lawyer" | "litigant" | "clerk";

export interface ENSIP25KeyArgs {
  registryInteropAddress: string; // "eip155:<chainId>:<addr>"
  agentId: string;
}

export function ensip25TextRecordKey(a: ENSIP25KeyArgs): string {
  return `verified-agent:${a.registryInteropAddress}:${a.agentId}`;
}

export interface AgentRecordArgs extends ENSIP25KeyArgs {
  role: AgentRole;
  axlPeerId: string;     // hex64 ed25519 public key
  pubKey: string;        // ECDSA pubkey for the agent's wallet, hex
  credentials?: string[]; // ENS Track B: free-form claims, "kind:value"
}

/** Returns a flat record-key map suitable for ENS text-record writes. */
export function agentEnsRecord(a: AgentRecordArgs): Record<string, string> {
  return {
    [ensip25TextRecordKey(a)]: "1",
    "agent.role": a.role,
    "agent.axl-peer-id": a.axlPeerId,
    "agent.pubkey": a.pubKey,
    ...(a.credentials?.length ? { "agent.credentials": a.credentials.join(",") } : {}),
  };
}

// ---- Publishing helper (real implementation) ----------------------------
// The publish path uses @ensdomains/ensjs against an ENS-native chain
// (Sepolia for the hackathon). Kept thin so the pure helpers above can be
// unit-tested without a wallet.

export interface PublishArgs {
  rpcUrl: string;
  privateKey: `0x${string}`;
  parentName: string; // "tribunal.eth"
  label: string;      // "alice"
  records: Record<string, string>;
}

export async function publishAgentEnsRecords(args: PublishArgs): Promise<string> {
  const { createWalletClient, http } = await import("viem");
  const { privateKeyToAccount } = await import("viem/accounts");
  const { sepolia } = await import("viem/chains");
  const { addEnsContracts } = await import("@ensdomains/ensjs");
  const { setRecords } = await import("@ensdomains/ensjs/wallet");

  const account = privateKeyToAccount(args.privateKey);
  const client = createWalletClient({
    chain: addEnsContracts(sepolia),
    transport: http(args.rpcUrl),
    account,
  });
  const fullName = `${args.label}.${args.parentName}`;
  await setRecords(client as any, {
    name: fullName,
    texts: Object.entries(args.records).map(([key, value]) => ({ key, value })),
  } as any);
  return fullName;
}
