/**
 * Publish ENSIP-25 + agent text records on Sepolia for every Tribunal
 * agent that's been registered on the 0G testnet AgentRegistry.
 *
 * Reads the registry on-chain to find every agent (id 1..nextId-1), pulls
 * the AXL peer id from the running clerk/lawyer/judge nodes when an
 * obvious ENS-name → port mapping applies, and writes:
 *
 *   verified-agent:eip155:<chainId>:<registryAddr>:<id>  =  "1"
 *   agent.role                                           =  judge | litigant | ...
 *   agent.axl-peer-id                                    =  <hex64>     (when known)
 *   agent.pubkey                                         =  <addr hex>  (registry owner)
 *   agent.credentials                                    =  comma list  (judge only)
 *
 * Required env (from repo .env):
 *   OG_RPC_URL                     0G testnet RPC
 *   ENS_RPC_URL                    Sepolia RPC for ENS writes
 *   ENS_PRIVATE_KEY                Signer that owns the parent ENS name
 *   ENS_PARENT_NAME                e.g. "tribunal.eth"
 *
 * Run:
 *   npx tsx scripts/publish-ens-records.ts
 */

import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import {
  agentEnsRecord,
  publishAgentEnsRecords,
  type AgentRole,
} from "../agents/src/identity/ens.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function envOrThrow(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

interface DeploymentJson {
  network: string;
  AgentRegistry: string;
}

interface OnchainAgent {
  id: bigint;
  owner: string;
  ensName: string;
  role: string;
}

const REGISTRY_ABI = [
  "function nextId() view returns (uint256)",
  "function agents(uint256) view returns (address owner, string ensName, string role, bool active)",
];

/// Best-effort mapping from agent ENS name → AXL API port. Lets the script
/// publish each agent's peer id without us having to type it in.
const AXL_PORT_BY_LABEL: Record<string, number> = {
  "judge-athena": 9032,
  "lawyer-quinn": 9012,
  "lawyer-rivers": 9022,
};

async function fetchPeerIdFromPort(port: number): Promise<string | undefined> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/topology`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return undefined;
    const body = (await r.json()) as { our_public_key: string };
    return body.our_public_key;
  } catch {
    return undefined;
  }
}

async function main() {
  const ogRpcUrl  = envOrThrow("OG_RPC_URL");
  const ensRpcUrl = envOrThrow("ENS_RPC_URL");
  const rawEnsPk = envOrThrow("ENS_PRIVATE_KEY");
  const ensPk = (rawEnsPk.startsWith("0x") ? rawEnsPk : `0x${rawEnsPk}`) as `0x${string}`;
  const parent    = envOrThrow("ENS_PARENT_NAME");

  // Load deployment to know the registry address + chainId.
  const dep = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../docs/deployment.json"), "utf8"),
  ) as DeploymentJson;
  const interopAddr = `eip155:${dep.network}:${dep.AgentRegistry}`;

  // Read all registered agents.
  const provider = new ethers.JsonRpcProvider(ogRpcUrl);
  const reg = new ethers.Contract(dep.AgentRegistry, REGISTRY_ABI, provider);
  const next = Number(await reg.nextId());

  const agents: OnchainAgent[] = [];
  for (let i = 1; i < next; i++) {
    const a = await reg.agents(BigInt(i));
    agents.push({ id: BigInt(i), owner: a.owner, ensName: a.ensName, role: a.role });
  }
  if (agents.length === 0) {
    console.log("No agents registered on-chain yet. Run the demo first.");
    return;
  }
  console.log(`Found ${agents.length} agent(s) on AgentRegistry:`);
  for (const a of agents) console.log(`  #${a.id} ${a.ensName.padEnd(36)} ${a.role.padEnd(10)} owner=${a.owner}`);

  for (const a of agents) {
    // Derive label (e.g. "alice" from "alice.tribunal.eth"); skip if the
    // ENS name doesn't end in our parent.
    if (!a.ensName.endsWith(`.${parent}`)) {
      console.log(`Skipping ${a.ensName}: not under .${parent}`);
      continue;
    }
    const label = a.ensName.slice(0, -(parent.length + 1));
    const port = AXL_PORT_BY_LABEL[label];
    const axlPeerId = port ? await fetchPeerIdFromPort(port) : undefined;
    if (port && !axlPeerId) {
      console.log(`Note: ${label} maps to port ${port} but AXL not reachable; publishing without peer id.`);
    }

    const credentials = a.role === "judge" ? ["bar:0g-bar-association", "specialty:textualism"] : [];

    const records = agentEnsRecord({
      registryInteropAddress: interopAddr,
      agentId: a.id.toString(),
      role: a.role as AgentRole,
      axlPeerId: axlPeerId ?? "",
      pubKey: a.owner, // for the hackathon, store the registry owner address as the pubkey
      credentials,
    });
    const fullName = await publishAgentEnsRecords({
      rpcUrl: ensRpcUrl,
      privateKey: ensPk,
      parentName: parent,
      label,
      records,
    });
    console.log(`Published records for ${fullName} (agent #${a.id})`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
