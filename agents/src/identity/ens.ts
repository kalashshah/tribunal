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
  const {
    createWalletClient,
    createPublicClient,
    http,
    namehash,
    keccak256,
    toHex,
    stringToBytes,
  } = await import("viem");
  const { privateKeyToAccount } = await import("viem/accounts");
  const { sepolia } = await import("viem/chains");

  const account = privateKeyToAccount(args.privateKey);
  const wallet = createWalletClient({ chain: sepolia, transport: http(args.rpcUrl), account });
  const reader = createPublicClient({ chain: sepolia, transport: http(args.rpcUrl) });

  const fullName = `${args.label}.${args.parentName}`;
  const labelHash = keccak256(stringToBytes(args.label));
  const parentNode = namehash(args.parentName);
  const subNode = namehash(fullName);

  // ENS Registry canonical address (same on all chains).
  const ENS_REGISTRY = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e" as const;
  const REGISTRY_ABI = [
    { name: "resolver", type: "function", stateMutability: "view",
      inputs: [{ type: "bytes32" }], outputs: [{ type: "address" }] },
    { name: "owner", type: "function", stateMutability: "view",
      inputs: [{ type: "bytes32" }], outputs: [{ type: "address" }] },
    { name: "setSubnodeRecord", type: "function", stateMutability: "nonpayable",
      inputs: [
        { type: "bytes32", name: "node" },
        { type: "bytes32", name: "label" },
        { type: "address", name: "owner" },
        { type: "address", name: "resolver" },
        { type: "uint64",  name: "ttl" },
      ], outputs: [] },
  ] as const;
  const RESOLVER_ABI = [
    { name: "setText", type: "function", stateMutability: "nonpayable",
      inputs: [
        { type: "bytes32", name: "node" },
        { type: "string",  name: "key" },
        { type: "string",  name: "value" },
      ], outputs: [] },
  ] as const;

  const parentResolver = await reader.readContract({
    address: ENS_REGISTRY, abi: REGISTRY_ABI, functionName: "resolver", args: [parentNode],
  });
  if (parentResolver === "0x0000000000000000000000000000000000000000") {
    throw new Error(`Parent ${args.parentName} has no resolver. Set one on the parent first.`);
  }

  // Create or reuse the subname.
  const currentResolver = await reader.readContract({
    address: ENS_REGISTRY, abi: REGISTRY_ABI, functionName: "resolver", args: [subNode],
  });
  if (currentResolver === "0x0000000000000000000000000000000000000000") {
    const txHash = await wallet.writeContract({
      address: ENS_REGISTRY,
      abi: REGISTRY_ABI,
      functionName: "setSubnodeRecord",
      args: [parentNode, labelHash, account.address, parentResolver, 0n],
    });
    await reader.waitForTransactionReceipt({ hash: txHash });
  }

  // Set each text record. One tx per record keeps each call simple and
  // sidesteps ENSjs multicall quirks against legacy resolvers.
  const resolver = (currentResolver === "0x0000000000000000000000000000000000000000")
    ? parentResolver
    : currentResolver;
  for (const [key, value] of Object.entries(args.records)) {
    const txHash = await wallet.writeContract({
      address: resolver,
      abi: RESOLVER_ABI,
      functionName: "setText",
      args: [subNode, key, value],
    });
    await reader.waitForTransactionReceipt({ hash: txHash });
  }
  // Silence unused-import warning when keccak256/toHex aren't reached above.
  void toHex;
  return fullName;
}
