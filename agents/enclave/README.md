# Tribunal judge enclave

Local Node service that fronts Gensyn's
[Reproducible Execution Environment (REE)](https://docs.gensyn.ai/tech/ree/get-started)
for the Tribunal judge agent. The judge's LLM call lands here instead of
on OpenRouter; the enclave runs the prompt through REE, captures the
inference receipt, and returns both the text and a pointer to the
receipt blob. The receipt hash gets attached on-chain alongside the
verdict, so anyone can re-run REE in `verify` mode and confirm the
verdict was produced by the claimed model on the claimed inputs.

This is **not** a TEE today. The "enclave" name is forward-looking —
the wire format and signing flow are TEE-shaped so swapping in a real
TEE later (Phala, Marlin) is a contained change.

## Endpoints

| Method | Path              | Purpose                                                 |
| ------ | ----------------- | ------------------------------------------------------- |
| POST   | `/complete`       | Llm-shape prompt → `{ text, receipt: { hash, url } }`   |
| POST   | `/judge`          | Sign a verdict envelope with the enclave key (optional) |
| GET    | `/receipts/:hash` | Fetch a stored receipt blob                             |
| GET    | `/attestation`    | Enclave pubkey + (placeholder) attestation              |
| GET    | `/health`         | Liveness                                                |

## How the REE call actually works

REE is **CLI-only** — there is no HTTP `--serve` mode. Each `/complete`
call shells out:

```
docker run --rm \
  -v ~/.cache:/home/gensyn/.cache \
  gensynai/ree:v0.2.0 run-all \
  --task-dir /home/gensyn/.cache/gensyn/runs/<uuid> \
  --model-name <model> \
  --prompt-text <flattened prompt> \
  --max-new-tokens <n> \
  --operation-set reproducible \
  [--cpu-only]
```

After the container exits, the enclave reads
`receipt_*.json` from the per-call task-dir, computes
`keccak256(receipt_bytes)`, serves the bytes from
`/receipts/<hash>`, and returns text + receipt pointer.

## Prerequisites

- Docker Desktop running on the host.
- Pull the REE image once:
  ```bash
  docker pull gensynai/ree:v0.2.0
  ```
- Node 20+.

## Why this service runs on the host (not in a container)

The enclave is intentionally **not** containerized, and there is no
`docker-compose.yml` for it. REE is one-shot Docker — every `/complete`
call does its own `docker run --rm gensynai/ree:v0.2.0 run-all ...`. If
the enclave service were also a container, every inference would need
either:

- **DinD** (docker-in-docker) — privileged mode, separate daemon, an
  extra multi-GB cache layer for the REE image; or
- **DooD** — bind-mount `/var/run/docker.sock` from the host, then
  plumb a `HOST_CACHE_ROOT` env var so the `-v cacheRoot:/home/gensyn/.cache`
  flag we pass to REE resolves to a real host path instead of a path
  inside the enclave container.

Either option is more moving parts for identical behavior. The host
already has Docker (you used it to pull the REE image), so the enclave
runs as a plain Node process and shells out. If we ever move to a real
TEE host (Phala/Marlin), that environment will dictate its own
packaging — there's no point pre-containerizing for it now.

## Run it

```bash
cd agents/enclave
npm install
npm run build
npm start
```

Environment variables:

| Var                 | Default                      | Notes                                         |
| ------------------- | ---------------------------- | --------------------------------------------- |
| `PORT`              | `9000`                       |                                               |
| `REE_IMAGE`         | `gensynai/ree:v0.2.0`        |                                               |
| `REE_MODEL`         | `Qwen/Qwen2.5-0.5B-Instruct` | smallest reproducible model                   |
| `REE_CPU_ONLY`      | `1`                          | set `0` + configure `runtime: nvidia` for GPU |
| `REE_CACHE_ROOT`    | `~/.cache`                   | HF + gensyn-sdk artifacts                     |
| `REE_TIMEOUT_MS`    | `1800000`                    | 30-minute hard cap per inference              |
| `ENCLAVE_PRIVKEY`   | hardhat-account-1            | enclave signing key                           |
| `ENCLAVE_API_TOKEN` | —                            | optional bearer auth on `/complete`           |

### Smoke test

```bash
curl -sS http://127.0.0.1:9000/health
curl -sS -X POST http://127.0.0.1:9000/complete \
  -H 'content-type: application/json' \
  -d '{"system":"You answer in JSON.","messages":[{"role":"user","content":"Say {\"ok\":true}."}]}'
```

The first call may take 10–30 min on CPU (model download + ONNX export).
Subsequent calls are faster.

### Verifying a produced receipt

Receipts are reproducible. Pick a stored receipt path and re-run REE:

```bash
docker run --rm -v ~/.cache:/home/gensyn/.cache gensynai/ree:v0.2.0 \
  verify --receipt-path /home/gensyn/.cache/gensyn/runs/<uuid>/receipt_*.json
```

A `VERIFICATION PASSED` line on stdout proves the verdict was generated
by the claimed model on the claimed inputs.

## Wiring it to the agents runner

```bash
JUDGE_LLM_PROVIDER=ree \
REE_URL=http://127.0.0.1:9000 \
JUDGE_REE_MODEL=Qwen/Qwen2.5-0.5B-Instruct \
  pnpm --filter @tribunal/agents demo
```

`pickJudgeLlmFromEnv()` in `agents/src/llm/index.ts` recognises
`JUDGE_LLM_PROVIDER=ree` and routes only the judge to this service.
Lawyers continue on whatever `LLM_PROVIDER` resolves to (typically
OpenRouter), so the demo stays fast.

## Dev fast path

If you want to skip the enclave entirely for dev iteration on
non-judge code, set `LLM_PROVIDER=canned` (or anthropic / openai /
openrouter) and **don't** set `JUDGE_LLM_PROVIDER`. The judge will run
on the same fast provider, and no on-chain receipt will be attached.
There is no mock-REE mode by design — fake receipts would defeat the
whole point of REE.

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
