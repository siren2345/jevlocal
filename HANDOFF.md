# Handoff — jevlocal-mac

Updated: 2026-09-22

## Goal and non-goals

The project provides a **loopback, JeV-compatible HTTP gateway on macOS**.
Only public endpoint names and JSON schemas are compatibility promises:
`POST /v1/systemone` and `POST /v1/decide`, with `choice`, `noul`, and
`score`. Do not claim JeV-equivalent model logic, context capacity,
probability calibration, or algorithms.

The current direction is a deterministic provider cascade:

```text
client -> gateway :9011
          -> Laya Core ML / ANE :9012   (only explicitly admitted profiles)
          -> SemIf / MLX :9013          (quality default and Laya fallback)
```

Do not restore a global Laya-confidence threshold. Its confidence was shown to
be task-dependent and Laya performs poorly on hard general decisions.

## Current committed state

Latest commit at handoff: `acfa080 Benchmark single decode against SemIf choice tasks`.

Important commits:

- `d43eda9 Add SemIf quality provider and Laya cascade`
- `acfa080 Benchmark single decode against SemIf choice tasks`

The following untracked files existed before this handoff and were deliberately
not staged or edited:

- `docs/provider-evaluations/gemma-3-4b-it-q4-k-m-2026-09-22.md`
- `docs/provider-evaluations/qwen3.5-4b-q4-k-m-2026-09-22.md`

## Running local services

At handoff, these loopback services are running:

| Port | Process | Role |
| ---: | --- | --- |
| 9011 | `node server.mjs` | gateway, started with `JEVLOCAL_PROVIDER=cascade` |
| 9012 | Core ML FastAPI server in `/Users/ryo/jevlocal-coreml-experiment` | Laya ANE |
| 9013 | `providers/semif_server.py` | SemIf MLX / Qwen3.5-4B Q4 |

The temporary single-decode test services on ports 8091 and 9034 were stopped.

The SemIf test environment is currently external:
`/tmp/semif.ZS8ksK/repo/.venv`. It has SemIf commit
`1f2dea3e25379f9dfc98cb83c324f00ab5deda37`, MLX 0.32.2, and the pinned
Qwen3.5 revision. The first model download resides in Hugging Face cache. The
README describes the intended reproducible installation under `vendor/SemIf`,
but the vendor clone/venv has not yet been committed or provisioned by a setup
script.

## Provider behavior

`server.mjs` supports:

- `JEVLOCAL_PROVIDER=semif` (default): every request goes to SemIf.
- `JEVLOCAL_PROVIDER=cascade`: a request goes to Laya only when
  `routing_profile` or `metadata.routing_profile` is present in the
  comma-separated `JEVLOCAL_LAYA_PROFILES` environment variable. Otherwise it
  goes to SemIf. Laya provider failures retry once on SemIf.
- `JEVLOCAL_PROVIDER=generated`: legacy llama.cpp one-token decode comparison
  path, not the quality default.

SemIf supports 2–16 options. The outer schema still permits Choice with up to
26 options; SemIf correctly returns 422 for a 17–26 option request instead of
truncating it. A future provider policy must make that limitation explicit.

The SemIf probabilities are native option-logit softmax scores conditional on
the supplied options. They are **not calibrated** for a caller's workload.

## Measurements

### SemIf, local public JevBench run

Run on an M5 MacBook Air with 16 GB unified memory, SemIf MLX 4-bit,
Qwen3.5-4B, while Laya ANE remained loaded:

| Public cohort | Correct | Accuracy | p50 | p95 |
| --- | ---: | ---: | ---: | ---: |
| easy | 48 / 48 | 100.0% | 204 ms | 256 ms |
| standard | 68 / 72 | 94.4% | 206 ms | 265 ms |
| hard | 65 / 111 | 58.6% | 807 ms | 4,942 ms |
| all public | 181 / 231 | 78.4% | 265 ms | 4,761 ms |

This is public-only evidence, not a JevBench leaderboard submission. Details:
`docs/provider-evaluations/semif-mlx-jevbench-public-2026-09-22.md`.

### Laya

JevBench's published full-suite Laya result is strong on easy items but weak on
hard items (easy 94.4%, hard 34.1%). This supports using it only for validated
fast profiles, never as a broad first pass.

### jev-single-decode

The user-owned `siren2345/jev-single-decode` was evaluated unchanged on the
same public Choice-only slice (139 tasks) with Qwen3.5-4B Q4 Metal:

| Provider | Correct | Accuracy | p50 | p95 | ECE |
| --- | ---: | ---: | ---: | ---: | ---: |
| single-decode | 47 / 139 | 33.8% | 785 ms | 7.90 s | 0.265 |
| SemIf MLX Q4 | 109 / 139 | 78.4% | 266 ms | 4.81 s | — |

Do not use single-decode as the quality route in its current state. It handles
Choice only, reads `post_sampling_probs` after grammar/logit bias rather than
native pre-sampling logits, and the test llama.cpp load emitted unused Qwen3.5
tensors. Issue filed: https://github.com/siren2345/jev-single-decode/issues/1

## Safe next work

1. Add a reproducible SemIf install/start script and a dependency lock or
   documented pinned checkout. Do not rely on the current `/tmp` venv.
2. Bring the public JevBench runner/conversion into this repository so
   SemIf, Laya, cascade, and generated paths write comparable artifacts.
   Never train/tune on the private split.
3. Define one real, labeled Laya task profile from user workload data. Its
   deterministic matcher, capacity limit, admitted accuracy, and fallback
   behavior must be recorded before placing its name in `JEVLOCAL_LAYA_PROFILES`.
4. Fit/validate calibration out-of-fold per workload before using SemIf or
   Laya confidence to trigger escalation.
5. Keep 2048 and BBQ as integration/diagnostic tests, not as the main quality
   benchmark.

## Verification commands

```bash
cd /Users/ryo/jevlocal-mac
npm test
curl -fsS http://127.0.0.1:9011/health
curl -fsS http://127.0.0.1:9013/health
```

The live gateway should report `provider_mode: cascade` at this handoff, with
an empty `laya_profiles` list. That means every ordinary request currently
uses SemIf, which is intentional.
