---
name: MCP-first agent identity, ENS auto-naming, and case-filing fee
description: Replaces operator-signed case filing with agent-signed MCP filing, drops on-chain string names in favor of address-keyed registry + Sepolia ENS auto-publication, and adds a base fee on fileCase
status: draft
date: 2026-04-30
---

# Tribunal — MCP-first identity, auto-named ENS, and case-filing fee

## Goals

1. Make case filing **MCP-first**: AI agents (Claude, GPT, etc.) file cases by invoking tool calls on a local MCP server that signs every transaction with a key the agent controls. The web UI becomes a read-only courtroom viewer.
2. Eliminate the operator-key shim in `web/app/api/cases/route.ts`. The accuser's address — recovered from a signed transaction — is the only source of "who is filing."
3. Move agent identity off of on-chain string names. Contracts speak addresses only. ENS subnames under `tribunal.eth` are auto-assigned on Sepolia from a curated wordlist (no numbers) and are purely a UI label.
4. Add a base fee on `fileCase` to discourage spam, payable in OG, accumulated in `TribunalCore` for later distribution (out of scope for this spec).
5. Restrict `judge` and `lawyer` roles to addresses admitted by the registry owner. Litigant role is implicit.

### Non-goals

- Refundable fees, fee splits, or judge token rewards. Fee just accumulates; sweep is owner-only.
- Cross-chain ENS resolution at the contract level. ENS is Sepolia-only and read off-chain.
- Vanity-name claims. Names are deterministically auto-assigned and not user-overridable in v1.
- Replacing existing on-chain demo data. Old `AgentRegistry` / `TribunalCore` deployments on 0G are abandoned; new contracts get fresh addresses.
- Web wallet integration (RainbowKit / SIWE in the browser). Web is read-only.

## Architecture

```
                                ┌────────────────────────┐
   AI agent (Claude / GPT) ──── │ Local MCP server       │
                                │  - holds private key   │
                                │  - signs txns          │
                                │  - SIWE-auth to web    │
                                └──────────┬─────────────┘
                                           │ rawTx, reads
                                           ▼
   Human viewer ─── Web (Next.js read-only) ◄─────────── Web backend
                                                              │
                                                              ├── 0G Galileo RPC  (TribunalCore, AgentRegistry, ...)
                                                              ├── Sepolia RPC     (tribunal.eth subname publishing)
                                                              └── 0G Storage      (case CIDs, evidence)
```

There is **one signing authority per agent**: the private key the agent controls (in env, KMS, etc.). The web backend never holds an agent key — it relays signed transactions and reads chain state.

The web backend *does* hold the `tribunal.eth` parent-owner key on Sepolia, used solely to publish subnames. This key is operational infrastructure, not user identity.

## On-chain changes

### `AgentRegistry` (rewritten)

```solidity
enum Role { None, Lawyer, Judge }

contract AgentRegistry is Ownable {
    mapping(address => Role) public roleOf;

    event RoleAdmitted(address indexed who, Role role);
    event RoleRevoked(address indexed who, Role previous);

    function admitJudge(address a)  external onlyOwner;
    function admitLawyer(address a) external onlyOwner;
    function revoke(address a)      external onlyOwner;
}
```

No `idByEns`. No `agents[]`. No `register(name, role)`. Litigants have `roleOf(addr) == None` — anyone with a wallet can file as one, gated only by the fee. The `None` value is the default and is also what unadmitted addresses return.

### `TribunalCore` (modified)

`fileCase` no longer takes agent IDs. New signature:

```solidity
uint256 public constant BASE_FEE = 0.01 ether; // 0.01 OG (chain native)
uint256 public feesAccrued;

function fileCase(
    address defendant,
    address escrowAdapter,
    uint256 escrowId,
    string calldata accusationCid
) external payable returns (uint256 caseId);
//   require msg.value >= BASE_FEE
//   feesAccrued += msg.value
//   accuser := msg.sender
//   emit CaseFiled(caseId, msg.sender, defendant, escrowAdapter, escrowId, accusationCid)

function withdrawFees(address to) external onlyOwner;
```

Other state-changing entry points get role gating:

- `submitArgument(...)` → `require(registry.roleOf(msg.sender) == Role.Lawyer)`
- `submitRuling(...)`   → `require(registry.roleOf(msg.sender) == Role.Judge)`
- Clerk events (`recordEvent`, etc.) — keep current authorization (clerk address whitelisted in constructor or via setter).

`Case` struct: replace `accuserAgentId` / `defendantAgentId` (`uint256`) with `accuser` / `defendant` (`address`). All downstream readers update.

### Other contracts

- `EscrowAdapter` — no changes; already address-based.
- `VerdictLog` — no changes; already address-based.
- `JudgeINFT` — `appendRulingMemory` still keyed by `tokenId`; the memory-writer authorization (the Tribunal address) is unchanged. No agent-id lookup involved.

### Deployment script

`scripts/deploy-0g.ts` extends to call:

```ts
await registry.admitJudge(JUDGE_A_ADDRESS);
await registry.admitJudge(JUDGE_B_ADDRESS);
await registry.admitJudge(JUDGE_C_ADDRESS);
await registry.admitLawyer(LAWYER_A_ADDRESS);
await registry.admitLawyer(LAWYER_B_ADDRESS);
```

Addresses come from env (`JUDGE_A_ADDRESS`, etc.) — these correspond to the keys the demo agents use. New `docs/deployment.json` is written.

## MCP server

A new package: `mcp/` (Node, TypeScript, stdio MCP transport). Built with the official `@modelcontextprotocol/sdk`.

### Configuration (env)

| Variable | Purpose |
|---|---|
| `TRIBUNAL_AGENT_PRIVATE_KEY` | The agent's signing key (`0x...`). Hex, 32 bytes. |
| `TRIBUNAL_RPC_URL` | 0G Galileo RPC URL. |
| `TRIBUNAL_BACKEND_URL` | Web backend base URL (for reads + relay). |
| `TRIBUNAL_DEPLOYMENT_PATH` | Path to `docs/deployment.json` for contract addresses. |

The MCP server starts up, derives the address from the key, and exposes the tool surface below. It is stateless — every call re-reads config and signs fresh.

### Tool surface

| Tool | Auth | Action |
|---|---|---|
| `tribunal_whoami` | local-key | Returns `{address, ensName}`. Calls `POST /api/identity/whoami` with a fresh signed nonce to trigger ENS auto-publish on first use. |
| `tribunal_resolve` | none | `{addressOrName}` → `{address, ensName}`. Public read via `GET /api/identity/resolve`. |
| `tribunal_file_case` | local-key | Accepts `{defendant, accusation, escrow?, escrowId?}`. Resolves defendant → address. Constructs and signs the `fileCase` tx with `value = BASE_FEE`. POSTs `{rawTx}` to `POST /api/cases` for relay. Returns `{caseId, txHash, explorerUrl}`. |
| `tribunal_get_case` | none | `{caseId}` → full case state, parties (with `ensName`), events, verdict if any. |
| `tribunal_list_cases` | none | Filters: `{party?, status?}`. |
| `tribunal_get_verdict` | none | `{caseId}` → ruling, judges' reasoning, KeeperHub trigger payload. |

### Signing model

Two signature paths, both using the local key:

1. **EIP-191 / SIWE-style** (off-chain auth): `tribunal_whoami` signs a message of the form
   ```
   tribunal-auth
   address: <0x...>
   nonce: <random>
   issued-at: <ISO-8601>
   ```
   Server verifies with `ecrecover` and confirms `recovered == claimed address`. No session cookie; this verification fires once per `whoami` call.

2. **EVM transaction** (on-chain writes): `tribunal_file_case` builds a typed-2 transaction targeting `TribunalCore.fileCase(...)` with the correct `value`, signs with the local key, and submits the raw bytes to the relay endpoint. The contract's `msg.sender` is the agent.

The server **never** sends the private key over the wire. SIWE messages and signed transactions only.

### Defendant input handling

The `defendant` field in `tribunal_file_case` accepts either:

- A 40-character hex address (`/^0x[a-fA-F0-9]{40}$/`) — used directly.
- An ENS name ending in `.tribunal.eth` — resolved server-side via `GET /api/identity/resolve?name=...`. If unresolved, the call fails with a clear error message instructing the caller to pass an address.

After successful filing, the backend's case-filed hook ensures the defendant has an auto-assigned name too (publishes if missing). The MCP does not handle this directly.

## Web backend

### Endpoints kept (read-only)

- `GET  /api/cases` — list (new; supports `?party=` and `?status=` filters)
- `GET  /api/cases/[caseId]` — single case
- `GET  /api/cases/[caseId]/events` — event stream (existing)
- `GET  /api/cases/[caseId]/answers` — judge Q&A answers (existing)
- `GET  /api/cases/[caseId]/questions` — open questions (existing)
- `GET  /api/cases/[caseId]/verdict` — verdict (existing)
- `GET  /api/judges` — judge list (existing)

### Endpoints rewritten

- `POST /api/cases` — was: operator-signs `fileCase`. Now: accepts `{rawTx: 0x...}`, validates that the decoded tx targets `TribunalCore.fileCase` with `value >= BASE_FEE`, broadcasts via `eth_sendRawTransaction`, awaits receipt, parses `CaseFiled` event for `caseId`. Triggers `ensureEnsName(defendant)` post-receipt. Returns `{caseId, txHash, explorerUrl}`. The hardcoded `ROLE_KEYS` map is deleted.

### Endpoints added

- `POST /api/identity/whoami` — body `{address, signature, message}`; verifies, ensures ENS subname exists for `address` (publishes if missing), returns `{address, ensName}`.
- `GET  /api/identity/resolve?name=` *or* `?address=` — bidirectional. For `?name`, ENS forward resolution on Sepolia. For `?address`, reverse cache lookup populated by the publish events.

### ENS auto-name resolver (server-side)

Algorithm `ensureEnsName(address) -> ensName`:

1. Cache hit? Return cached name. Cache is a JSON file under `web/var/ens-cache.json` (keyed by lowercase address). Acceptable for single-server hackathon; replaceable with Redis/Postgres later.
2. Cache miss → derive deterministic candidate:
   - `seed = keccak256(address)`
   - `adj = ADJECTIVES[uint(seed[0:2]) % len(ADJECTIVES)]`
   - `noun = NOUNS[uint(seed[2:4]) % len(NOUNS)]`
   - `candidate = "${adj}-${noun}"`
3. Check Sepolia: `ENS.resolver(namehash("${candidate}.tribunal.eth"))`. If zero (unclaimed) → publish via existing `publishAgentEnsRecords` with text records:
   - `agent.role` (read from on-chain `AgentRegistry.roleOf(address)`; render `None` as `"litigant"` in the text record)
   - `agent.address` (the address itself, hex)
   - ENSIP-25 `verified-agent:eip155:16602:<AgentRegistry>:<address>` = `1`
4. If non-zero (collision) → `seed = keccak256(seed)`, retry. Cap at 8 retries; fail loudly if all collide.
5. Cache the result, return.

#### Wordlist

- ~250 adjectives (`stoic`, `loyal`, `wry`, `calm`, ...) — curated, no profanity, no numbers, no hyphens within a word.
- ~250 nouns (`falcon`, `ibis`, `walrus`, `oak`, ...) — same standards.

Lists committed under `agents/src/identity/wordlist.ts`. Targeted ~62k combos; collisions remain rare even with thousands of users (birthday-paradox-tolerable for hackathon scale).

#### When auto-publish fires

- `POST /api/identity/whoami` — for the connecting agent.
- `POST /api/cases` (after successful relay) — for the defendant address if not yet named.

Auto-publish is best-effort. If Sepolia is down or the parent key has no funds, the case still files; the UI falls back to truncated address.

## Web UI

### Removed

- `web/components/DisputeForm.tsx` — deleted.
- `web/app/file/page.tsx` — deleted.
- Any link/button on `/` pointing at `/file` — replaced with an "Use the MCP" snippet showing how to install and configure the local server.

### Kept (no functional change)

- `/` — homepage. Eyebrow swap from "File a dispute" to "Watch live cases". Add a fenced code block with the MCP install + env-config snippet.
- `/case/[id]` — courtroom stream + verdict. Already read-only.
- `/judges` — already read-only.

### Name rendering

Anywhere a party address shows up, render `stoic-falcon.tribunal.eth` if known, else truncated `0x1234…abcd`. Uses `GET /api/identity/resolve?address=...`. Hook returns `{ ensName, isLoading }` and components fall back gracefully.

## Migration

- New 0G deployment: redeploy `AgentRegistry` (new ABI), `TribunalCore` (new `fileCase` signature, `BASE_FEE`, role checks), `EscrowAdapter`, `VerdictLog`, `JudgeINFT` (constructor args may change to point at new addresses). Run `admitJudge` / `admitLawyer` for the demo agents.
- Overwrite `docs/deployment.json` with the new addresses.
- Delete files: `web/components/DisputeForm.tsx`, `web/app/file/page.tsx`. The hardcoded `ROLE_KEYS` map inside `web/app/api/cases/route.ts` is removed; the file itself is rewritten as the relay endpoint.
- `agents/src/runner.ts` — drop `accuserAgentId`/`defendantAgentId` lookups in favor of address-only contract calls. Lawyer/judge agents already sign as themselves; their role admission happens at deploy time.
- `agents/src/identity/ens.ts` — `publishAgentEnsRecords` stays. Its caller moves from `scripts/publish-ens-records.ts` to the web backend's auto-name resolver. The script can become a verification helper (lists resolved names for the demo addresses).

Old testnet cases under the previous contracts are orphaned. Acceptable — testnet, hackathon, no users.

## Testing

### Contracts

- `fileCase` reverts when `msg.value < BASE_FEE`; succeeds when `>= BASE_FEE`; `feesAccrued` increments.
- `submitRuling` reverts unless caller is admitted as `Judge`; same for `submitArgument` and `Lawyer`.
- `admitJudge` / `admitLawyer` / `revoke` — `onlyOwner` enforcement.
- `withdrawFees` — `onlyOwner`, transfers exact balance, resets `feesAccrued`.

### MCP

- Tool registration: server starts, `list_tools` returns the documented surface.
- `tribunal_whoami` produces a valid SIWE message; backend mock verifies `ecrecover` recovers the expected address.
- `tribunal_file_case` resolves ENS-name defendant correctly; rejects unresolvable name; signs a tx whose decoded `to` and `data` match `TribunalCore.fileCase`.
- Relay round-trip: file → poll → confirm → returned `caseId` matches receipt.

### Web backend

- `POST /api/cases`: rejects rawTx with wrong target / wrong selector / insufficient `value`. Accepts and broadcasts a valid one. Triggers ENS publish for unnamed defendant.
- `POST /api/identity/whoami`: rejects bad signature; accepts good signature; returns `ensName`.
- `GET /api/identity/resolve`: name → address and address → name both round-trip.
- ENS resolver collision: forced collision retries up to cap; final failure is loud.

### End-to-end

- Existing demo (`npm run demo`) updates to: deploy with role admissions → start MCP server in-process → invoke `tribunal_file_case` → assert on-chain state. The hardhat-based fast path stays green.

## Open items

None. Ready for implementation plan.
