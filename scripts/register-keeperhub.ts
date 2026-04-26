/**
 * Programmatically register Tribunal's KeeperHub workflows via the public
 * REST API (https://app.keeperhub.com/api/workflows/create).
 *
 * Registers two workflows on the KeeperHub account:
 *
 *  1. tribunal-ruling-watch (event-triggered): listens for VerdictPosted on
 *     VerdictLog and reads casePrevailing back from TribunalCore — proves
 *     KeeperHub is watching our contracts and can react to on-chain state.
 *
 *  2. tribunal-deadline-scan (cron): every 10 minutes, reads nextCaseId
 *     from TribunalCore. The "stale Filed cases" alerting expansion goes
 *     in the UI later (it needs a Discord integrationId we don't yet have).
 *
 * Reads addresses from docs/deployment.json. Writes the resulting workflow
 * IDs back into docs/deployment.json under `keeperhub`.
 *
 * Required env (loaded from repo .env):
 *   KEEPERHUB_API_KEY
 *
 * Run:
 *   npx tsx scripts/register-keeperhub.ts
 */

import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEEPERHUB_BASE = process.env.KEEPERHUB_API_URL ?? "https://app.keeperhub.com";

interface DeploymentJson {
  network: string;
  AgentRegistry: string;
  TribunalCore: string;
  EscrowAdapter: string;
  VerdictLog: string;
  JudgeINFT: string;
  keeperhub?: {
    rulingWatchWorkflowId?: string;
    deadlineScanWorkflowId?: string;
  };
}

function envOrThrow(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

async function khFetch<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body: unknown,
  apiKey: string,
): Promise<T> {
  const res = await fetch(`${KEEPERHUB_BASE}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`KeeperHub ${method} ${path} HTTP ${res.status}: ${await res.text()}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const VERDICT_LOG_ABI = [
  {
    type: "event",
    name: "VerdictPosted",
    inputs: [
      { indexed: true, name: "caseId", type: "uint256" },
      { indexed: false, name: "prevailingIsAccuser", type: "bool" },
      { indexed: false, name: "opinionRoot", type: "bytes32" },
    ],
  },
];

const TRIBUNAL_READS_ABI = [
  {
    type: "function",
    name: "casePrevailing",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "nextCaseId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
];

interface CreatedWorkflow {
  id: string;
  name: string;
  description?: string;
}

function rulingWatchPayload(dep: DeploymentJson) {
  const network = dep.network;
  return {
    name: "tribunal-ruling-watch",
    description:
      "Triggered by VerdictLog.VerdictPosted on 0G testnet. Reads back casePrevailing from TribunalCore for the same case id, proving KeeperHub is wired into the Tribunal contract surface.",
    nodes: [
      {
        id: "trigger-1",
        type: "trigger",
        position: { x: 0, y: 0 },
        data: {
          type: "trigger",
          label: "On VerdictPosted",
          config: {
            triggerType: "Event",
            network,
            contractAddress: dep.VerdictLog,
            contractABI: JSON.stringify(VERDICT_LOG_ABI),
            eventName: "VerdictPosted",
          },
        },
      },
      {
        id: "read-1",
        type: "action",
        position: { x: 320, y: 0 },
        data: {
          type: "action",
          label: "Read casePrevailing",
          config: {
            actionType: "web3/read-contract",
            network,
            contractAddress: dep.TribunalCore,
            abiFunction: "casePrevailing",
            abi: JSON.stringify(TRIBUNAL_READS_ABI),
            functionArgs: '["{{@trigger-1:On VerdictPosted.caseId}}"]',
          },
        },
      },
    ],
    edges: [
      { id: "edge-1", source: "trigger-1", target: "read-1" },
    ],
  };
}

function deadlineScanPayload(dep: DeploymentJson) {
  const network = dep.network;
  return {
    name: "tribunal-deadline-scan",
    description:
      "Cron every 10 minutes. Reads TribunalCore.nextCaseId — surface for the future stale-case alerting expansion. Once a Discord integration is configured in the KeeperHub UI, add a discord/send-message action to alert on cases stuck in Filed status.",
    nodes: [
      {
        id: "trigger-1",
        type: "trigger",
        position: { x: 0, y: 0 },
        data: {
          type: "trigger",
          label: "Every 10 minutes",
          config: {
            triggerType: "Schedule",
            scheduleCron: "*/10 * * * *",
          },
        },
      },
      {
        id: "read-1",
        type: "action",
        position: { x: 320, y: 0 },
        data: {
          type: "action",
          label: "Read nextCaseId",
          config: {
            actionType: "web3/read-contract",
            network,
            contractAddress: dep.TribunalCore,
            abiFunction: "nextCaseId",
            abi: JSON.stringify(TRIBUNAL_READS_ABI),
            functionArgs: "[]",
          },
        },
      },
    ],
    edges: [
      { id: "edge-1", source: "trigger-1", target: "read-1" },
    ],
  };
}

async function findExistingByName(apiKey: string, name: string): Promise<string | undefined> {
  const list = await khFetch<{ id: string; name: string }[]>("GET", "/api/workflows", undefined, apiKey);
  const arr = Array.isArray(list) ? list : (list as any).workflows ?? [];
  return arr.find((w: any) => w.name === name)?.id;
}

async function upsertWorkflow(
  apiKey: string,
  name: string,
  payload: { name: string; description?: string; nodes?: unknown[]; edges?: unknown[] },
): Promise<string> {
  const existingId = await findExistingByName(apiKey, name);
  if (existingId) {
    await khFetch("PATCH", `/api/workflows/${existingId}`, payload, apiKey);
    return existingId;
  }
  const created = await khFetch<CreatedWorkflow>("POST", "/api/workflows/create", payload, apiKey);
  return created.id;
}

async function main() {
  const apiKey = envOrThrow("KEEPERHUB_API_KEY");
  const deploymentPath = path.resolve(__dirname, "../docs/deployment.json");
  const dep = JSON.parse(fs.readFileSync(deploymentPath, "utf8")) as DeploymentJson;

  console.log(`Registering workflows for chain ${dep.network} on ${KEEPERHUB_BASE}...`);

  const rulingId = await upsertWorkflow(apiKey, "tribunal-ruling-watch", rulingWatchPayload(dep));
  console.log(`  ruling-watch  -> id=${rulingId}`);

  const deadlineId = await upsertWorkflow(apiKey, "tribunal-deadline-scan", deadlineScanPayload(dep));
  console.log(`  deadline-scan -> id=${deadlineId}`);

  for (const id of [rulingId, deadlineId]) {
    await khFetch("PATCH", `/api/workflows/${id}`, { enabled: true }, apiKey);
  }
  console.log("  enabled both workflows.");

  dep.keeperhub = {
    rulingWatchWorkflowId: rulingId,
    deadlineScanWorkflowId: deadlineId,
  };
  fs.writeFileSync(deploymentPath, JSON.stringify(dep, null, 2));
  console.log(`Wrote workflow IDs to ${deploymentPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
