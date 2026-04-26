/**
 * Publish ENSIP-25 + agent text records for every Tribunal agent on Sepolia.
 * Run after the contracts are deployed and after the agents are registered.
 *
 * Required env:
 *   ENS_RPC_URL, ENS_PRIVATE_KEY, ENS_PARENT_NAME (e.g. "tribunal.eth")
 *   AGENT_REGISTRY_ADDR     — chain address of AgentRegistry on 0G testnet
 *   AGENT_REGISTRY_CHAIN_ID — defaults to 16601 (0G testnet)
 *   <LABEL>_AGENT_ID, <LABEL>_AXL_PEER_ID, <LABEL>_PUBKEY for each subname
 *
 * Run with tsx: `npx tsx scripts/publish-ens-records.ts`
 */

import "dotenv/config";
import {
  agentEnsRecord,
  publishAgentEnsRecords,
  type AgentRole,
} from "../agents/src/identity/ens.js";

interface SeedEntry {
  label: string;
  agentId: string;
  role: AgentRole;
  axlPeerId: string;
  pubKey: string;
  credentials?: string[];
}

function envOrThrow(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

async function main() {
  const rpcUrl = envOrThrow("ENS_RPC_URL");
  const privateKey = envOrThrow("ENS_PRIVATE_KEY") as `0x${string}`;
  const parentName = envOrThrow("ENS_PARENT_NAME");
  const chainId = process.env.AGENT_REGISTRY_CHAIN_ID ?? "16601";
  const registryAddr = envOrThrow("AGENT_REGISTRY_ADDR");
  const interopAddr = `eip155:${chainId}:${registryAddr}`;

  // Seed list — extend as you register more agents.
  const seed: SeedEntry[] = [
    {
      label: "judge-athena",
      agentId: process.env.JUDGE_ATHENA_AGENT_ID ?? "3",
      role: "judge",
      axlPeerId: envOrThrow("JUDGE_ATHENA_AXL_PEER_ID"),
      pubKey: process.env.JUDGE_ATHENA_PUBKEY ?? "0x",
      credentials: ["bar:0g-bar-association", "specialty:textualism"],
    },
    {
      label: "lawyer-quinn",
      agentId: process.env.LAWYER_QUINN_AGENT_ID ?? "6",
      role: "lawyer",
      axlPeerId: envOrThrow("LAWYER_QUINN_AXL_PEER_ID"),
      pubKey: process.env.LAWYER_QUINN_PUBKEY ?? "0x",
      credentials: ["bar:0g-bar-association"],
    },
    {
      label: "lawyer-rivers",
      agentId: process.env.LAWYER_RIVERS_AGENT_ID ?? "7",
      role: "lawyer",
      axlPeerId: envOrThrow("LAWYER_RIVERS_AXL_PEER_ID"),
      pubKey: process.env.LAWYER_RIVERS_PUBKEY ?? "0x",
      credentials: ["bar:0g-bar-association"],
    },
  ];

  for (const entry of seed) {
    const records = agentEnsRecord({
      registryInteropAddress: interopAddr,
      agentId: entry.agentId,
      role: entry.role,
      axlPeerId: entry.axlPeerId,
      pubKey: entry.pubKey,
      credentials: entry.credentials,
    });
    const fullName = await publishAgentEnsRecords({
      rpcUrl,
      privateKey,
      parentName,
      label: entry.label,
      records,
    });
    console.log(`Published records for ${fullName}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
