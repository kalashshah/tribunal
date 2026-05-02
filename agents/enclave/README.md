# Tribunal judge enclave

A small HTTP service that fronts Gensyn's Reproducible Execution
Environment (REE) for the Tribunal judge agent. The judge's LLM call goes
here instead of OpenRouter; the enclave runs the prompt through REE,
captures the inference receipt, and returns both the text and a pointer
to the receipt blob. The receipt hash gets attached on-chain alongside
the verdict, so anyone can re-run REE in verify mode and confirm the
verdict was produced by the claimed model on the claimed inputs.

This is **not** a TEE today. The "enclave" name is forward-looking —
the wire format and signing flow are TEE-shaped so swapping in a real
TEE later (Phala, Marlin) is a contained change.

## Endpoints

| Method | Path                | Purpose                                                    |
| ------ | ------------------- | ---------------------------------------------------------- |
| POST   | `/complete`         | Llm-shape prompt → `{ text, receipt: { hash, url } }`      |
| POST   | `/judge`            | Sign a verdict envelope with the enclave key (optional)    |
| GET    | `/receipts/:hash`   | Fetch a stored receipt blob                                |
| GET    | `/attestation`      | Enclave pubkey + (mock) attestation                        |
| GET    | `/health`           | Liveness                                                   |

## Run it locally (mock — fastest)

```bash
cd agents/enclave
MOCK_ATTESTATION=1 docker compose up enclave
curl localhost:9000/health
```

Mock mode skips REE entirely and returns canned judge output, so the
rest of Tribunal can develop end-to-end without the multi-GB model
download. Use this until everything else is wired up.

## Run with real REE (slow CPU path)

```bash
cd agents/enclave
docker compose --profile real up
# wait for the ree container's healthcheck to go green
```

Then point the agents runner at it:

```bash
JUDGE_LLM_PROVIDER=ree \
REE_URL=http://127.0.0.1:9000 \
pnpm --filter @tribunal/agents demo
```

`pickJudgeLlmFromEnv()` in `agents/src/llm/index.ts` recognises
`JUDGE_LLM_PROVIDER=ree` and routes only the judge to this service.
Lawyers continue on whatever `LLM_PROVIDER` resolves to (typically
OpenRouter), so the demo stays fast.

## With a real GPU

Edit `docker-compose.yml`:

- drop `--cpu-only` from the `ree` command,
- add `runtime: nvidia` and a `deploy.resources.reservations.devices`
  block requesting `gpu` capability.

Reproducible mode on a 3B–8B model on a single L4 produces tokens at
roughly conversational speed. CPU-only mode is fine for validating the
flow end-to-end but unsuitable for a live demo.

## On-chain integration

When the judge runs against this service, the AXL ruling message and
the keeper's `finalizeVerdictWithReceipt` call both carry the
`{ receiptHash, receiptUrl }` pair. `VerdictLog.attachReceipt` stores
them on-chain next to the verdict. The web UI's `VerdictCard` reads
both `verdicts(caseId)` and `receipts(caseId)`; when a receipt is
present it renders a "verifiable inference" badge with the link.

## Future TEE swap

When we move to a real TEE host (Phala/Marlin):

1. The enclave's eth privkey gets sealed inside the enclave instead of
   read from env. `sign.ts` already separates the signing concern.
2. `/attestation` returns a real remote-attestation quote.
3. `TribunalCore` adds an enclave-pubkey registry whose entries are
   gated on a known good attestation measurement; `attachReceipt` (or
   a new variant) can verify the envelope signature on-chain.

Today's mock signing exercises the same code path so step 3 stays
small.
