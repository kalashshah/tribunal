# Tribunal × Gensyn

Tribunal is a verifiable AI court for autonomous agents. Two pieces of Gensyn infrastructure are load-bearing in our system: **AXL** is the only transport between every agent in the courtroom, and **REE** is what makes a judge's ruling cryptographically verifiable. Without either, Tribunal is a centralised broker with a black-box LLM. With both, it is what we set out to build.

## What we built on Gensyn

### 1. AXL is the only courtroom transport

Every message in a Tribunal trial flows over **Gensyn AXL**, never through a centralised broker. Four AXL nodes run side-by-side: **clerk, lawyer-A, lawyer-B, judge**. All courtroom traffic (case filing, evidence submission, lawyer arguments, judge deliberation messages, REE receipt envelopes) is exchanged peer-to-peer over AXL.

The AXL transport wrapper:

- [`agents/src/transport/axl.ts`](../../agents/src/transport/axl.ts) — wraps the local Go node's HTTP API.
- [`agents/src/transport/axl.ts:33`](../../agents/src/transport/axl.ts#L33) — `POST /send` with `X-Destination-Peer-Id`.
- [`agents/src/transport/axl.ts:49`](../../agents/src/transport/axl.ts#L49) — `GET /recv` long-poll for inbound messages.
- [`agents/src/transport/axl.ts:63`](../../agents/src/transport/axl.ts#L63) — `GET /topology` to fetch our own peer id at startup.

The four-node setup is real (not in-process). Boot script and configuration:

- [`scripts/axl-up.sh`](../../scripts/axl-up.sh) — boots four AXL Go nodes (clerk, lawyer-A, lawyer-B, judge), each on its own port and ed25519 key, and waits for the spanning tree to form. Build instructions for the Go binary are at [`scripts/axl-up.sh:8`](../../scripts/axl-up.sh#L8).
- [`scripts/axl-down.sh`](../../scripts/axl-down.sh) — shuts the four nodes down.
- [`scripts/demo-up.sh`](../../scripts/demo-up.sh) / [`scripts/demo-down.sh`](../../scripts/demo-down.sh) — single-machine demo orchestration.
- The runner connects each agent to its own local AXL node via [`agents/src/runner.ts`](../../agents/src/runner.ts).

For unit tests, an in-process bus is available at [`agents/src/transport/in-memory.ts`](../../agents/src/transport/in-memory.ts), but the production and live demo paths use the real AXL Go nodes; the env switch is `AXL_USE_REAL=1` (see [`scripts/axl-up.sh:94`](../../scripts/axl-up.sh#L94)).

### 2. AXL peer ids published as ENSIP-25 records

Each agent's hex64 ed25519 AXL peer id is published as the `agent.axl-peer-id` text record on its `*.tribunal.eth` subname. Peer discovery and verification are end-to-end:

1. An agent resolves a counterparty's ENS name.
2. It reads `agent.axl-peer-id` and `agent.pubkey` from the text records.
3. It dials the AXL peer and verifies signed messages against the pubkey from ENS.

Code:

- [`agents/src/identity/ens.ts:34`](../../agents/src/identity/ens.ts#L34) — the record map writes `agent.axl-peer-id` to ENS.
- [`scripts/publish-ens-records.ts:11`](../../scripts/publish-ens-records.ts#L11) — publisher comment documenting the `agent.axl-peer-id = <hex64>` record.

Live on Sepolia: `judge-athena.tribunal.eth` carries `agent.axl-peer-id: 477075b7cc7ae6...` next to its `verified-agent:eip155:16602:…:3` ENSIP-25 attestation, `agent.role: judge`, `agent.pubkey`, and `agent.credentials`. A counterparty resolves the ENS name and gets the AXL peer id and the signing pubkey in the same lookup:

![ENS Profile for judge-athena.tribunal.eth on Sepolia showing agent.axl-peer-id alongside verified-agent, agent.role, agent.pubkey, agent.credentials](./images/ens-judge-athena-records.png)

The clerk only honors traffic from peers whose ENS records carry a `verified-agent` attestation pointing at an active 0G `AgentRegistry` entry. AXL gives us the encrypted transport; ENS gives us the gateable, verifiable identity layer on top.

### 3. Judge inference runs inside Gensyn REE

Judges do not just "call an LLM." Each judge's inference runs inside a **Reproducible Execution Environment** (`gensynai/ree:v0.2.0`). The flow:

```
agent → enclave → `gensynai/ree run-all`
       ← { text, receipt: { hash, url } }
```

Implementation:

- [`agents/enclave/`](../../agents/enclave/) — Node service that wraps REE.
- [`agents/enclave/src/server.ts`](../../agents/enclave/src/server.ts) — HTTP surface (`POST /complete`, `GET /receipts/:hash`, `GET /health`).
- [`agents/enclave/src/server.ts:63`](../../agents/enclave/src/server.ts#L63) — `handleComplete` calls into REE, persists the receipt, returns text + receipt pointer.
- [`agents/enclave/src/ree-client.ts`](../../agents/enclave/src/ree-client.ts) — REE driver. Comment at [L1](../../agents/enclave/src/ree-client.ts#L1) and [L4](../../agents/enclave/src/ree-client.ts#L4) document the spawn-per-inference flow: "spawns the Gensyn `gensynai/ree` container per inference, waits for exit, reads the receipt JSON, and returns text + receipt blob."
- [`agents/src/llm/ree.ts`](../../agents/src/llm/ree.ts) — agent-side `Llm` adapter that hits the local enclave service and surfaces `{ text, inputTokens, outputTokens, receipt: { hash, url } }`. See the contract at [L7](../../agents/src/llm/ree.ts#L7).
- [`agents/enclave/src/server.ts:43`](../../agents/enclave/src/server.ts#L43) — receipt store keyed by `keccak256(receipt_bytes)`.

### 4. REE receipts anchored on-chain

The receipt's hash and URL are anchored on-chain via `VerdictLog.attachReceipt` on 0G. This gives us a verifiable inference primitive end-to-end: anyone can re-run the receipt in REE's verify mode, reproduce the same verdict text from the same inputs, and detect tampering.

- [`contracts/src/VerdictLog.sol:21`](../../contracts/src/VerdictLog.sol#L21) — `Receipt { receiptHash, receiptUrl }` struct.
- [`contracts/src/VerdictLog.sol:30`](../../contracts/src/VerdictLog.sol#L30) — `VerdictReceiptAttached` event.
- [`contracts/src/VerdictLog.sol:49`](../../contracts/src/VerdictLog.sol#L49) — `attachReceipt(caseId, receiptHash, receiptUrl)`.
- [`scripts/ree-onchain-smoke.ts`](../../scripts/ree-onchain-smoke.ts) — end-to-end smoke test that runs an REE inference and posts the receipt on-chain.

### 5. TEE-shaped wire format

The REE flow is already shaped like a TEE attestation flow. A separate enclave key, a `/receipts/:hash` retrieval endpoint, and signed-by-the-enclave receipts mean swapping in a real TEE later (Phala, Marlin) is contained.

- [`agents/enclave/src/sign.ts`](../../agents/enclave/src/sign.ts) — enclave signing key, separate from any agent's wallet.
- [`agents/enclave/src/server.ts:105`](../../agents/enclave/src/server.ts#L105) — `GET /receipts/:hash` for receipt retrieval.
- [`agents/enclave/src/server.ts:119`](../../agents/enclave/src/server.ts#L119) — `/health` advertises `mode: "ree"` plus the image tag.

The contracts, the receipt anchoring, the verifier path, and the wire format do not move when swapping the attestation backend. Only the enclave runtime changes.

### 6. Verifiable receipt envelopes over AXL

REE receipt envelopes ride the same AXL transport as the rest of the courtroom traffic — they are not pushed through a side channel. The judge agent emits its verdict + receipt over AXL to the clerk, the clerk content-addresses it on 0G Storage and anchors the hash via `TribunalCore.recordEvent`. End-to-end, every byte the judge produces is auditable.
