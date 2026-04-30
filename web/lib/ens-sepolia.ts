import { createPublicClient, http, namehash } from "viem";
import { sepolia } from "viem/chains";
import { publishAgentEnsRecords, agentEnsRecord } from "../../agents/src/identity/ens";

const ENS_REGISTRY = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e" as const;
const REGISTRY_ABI = [
  { name: "resolver", type: "function", stateMutability: "view",
    inputs: [{ type: "bytes32" }], outputs: [{ type: "address" }] },
] as const;

export interface SepoliaConfig {
  rpcUrl: string;
  privateKey: `0x${string}`;
  parent: string; // "tribunal.eth"
  registryInteropAddress: string; // "eip155:16602:0x..."
}

export function makeSepoliaAdapter(cfg: SepoliaConfig) {
  const reader = createPublicClient({ chain: sepolia, transport: http(cfg.rpcUrl) });

  return {
    async isClaimed(label: string): Promise<boolean> {
      const node = namehash(`${label}.${cfg.parent}`);
      const resolver = await reader.readContract({
        address: ENS_REGISTRY, abi: REGISTRY_ABI, functionName: "resolver", args: [node],
      });
      return resolver !== "0x0000000000000000000000000000000000000000";
    },
    async publish(label: string, address: string, role: string): Promise<void> {
      const records = agentEnsRecord({
        registryInteropAddress: cfg.registryInteropAddress,
        agentId: address, // ENSIP-25 key now uses address instead of agent id
        role: role as any,
        axlPeerId: "",   // not yet known at registration time; can be appended later
        pubKey: address, // we have the address itself; full pubkey is optional
      });
      await publishAgentEnsRecords({
        rpcUrl: cfg.rpcUrl,
        privateKey: cfg.privateKey,
        parentName: cfg.parent,
        label,
        records,
      });
    },
  };
}
