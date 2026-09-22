# jevlocal-mac

One command gives you a local Jev-compatible typed-decision environment on
your Mac. No API key, no account, no configuration.

```bash
./setup.sh   # once: installs the fixed decision providers
./run.sh     # every time: starts everything, gateway on http://127.0.0.1:9011
```

Then decide:

```bash
curl http://127.0.0.1:9011/v1/systemone \
  -H 'Content-Type: application/json' \
  -d '{"state": {"ticket": "The customer was charged twice."},
       "questions": {"route": {"type": "choice",
         "instructions": {"task": "Choose the support team."},
         "criteria": {"billing": "Payment or duplicate charge issue",
                      "technical": "Application malfunction"}}}}'
```

## Concept

Jev-compatible typed decisions (`choice`, `noul`, `score`) from locally
installed providers, behind one loopback HTTP gateway. The decision engine
is fixed: SemIf's direct option-logit readout over Qwen3.5-4B on MLX.
A Laya Core ML fast path is tried automatically for compact inputs;
everything else, and every fast-path failure, is answered by SemIf.
There is nothing to configure and no provider to choose.

## Laya's role

Laya owns one job: compact intent/routing choice (single question, up to
8 options, roughly 72 tokens or less, no reasoning-shaped text) answered
in ~14 ms. Measured: 10/12 on such easy items; the 2 misses are
synonym-level confusions no input shape can separate.

Laya is not for games, multi-step planning, reasoning-shaped questions,
or anything over its input budget — verified weak (2048: score ~200 vs
SemIf ~1000, confidences near zero). Those stay on SemIf by construction.
The 1024-token GPU bundle exists upstream but is deliberately not wired
in: a bigger window never fixed the judgment gap in measurement.

## Scope

The compatibility promise is limited to the public HTTP interface:

- POST /v1/systemone and POST /v1/decide
- Jev-shaped choice, noul, and score request/response schema
- Choice criteria keys preserved exactly

It does not claim to reproduce TypeSafe Jev's model, probabilities,
context behavior, or algorithms.

## Architecture

    client
      -> jevlocal-mac gateway :9011 (loopback)
          -> validation and schema normalization
          -> automatic admission: compact choice -> Laya ANE :9012
          -> everything else, plus every fast-path failure -> SemIf MLX :9013

Admission is mechanical (input size, question shape), never a model call
and never a confidence threshold. Each answer reports the provider that
produced it in `metadata.provider` with the route reason.

## Requirements

- Apple Silicon Mac
- Node.js 20+
- Python 3.12 (`brew install python@3.12`)
- The Laya experiment checkout (default `/Users/ryo/jevlocal-coreml-experiment`,
  override with `LAYA_DIR=...`)

## Current API

`POST /v1/systemone` and `POST /v1/decide` accept a JeV-shaped request with
string or JSON-object `state` and `instructions`.

`choice` accepts 1–26 criteria and preserves the caller's criterion keys.
`noul` is evaluated as false/true, and `score` supports 2–10 ordered levels.
SemIf supports up to 26 options (local A–Z extension over upstream's 16;
see `vendor-patches/semif-letters-26.patch`), so a 27+ option question
receives a clear 422 response from that provider rather than a silently
truncated decision.
Probabilities are conditional native option-logit scores, not calibrated
Jev probabilities.

Run the no-model unit checks with:

```bash
npm test
```

Evaluate the whole gateway against the vendored public JevBench fixture:

```bash
node scripts/run-jevbench-public.mjs
```

## Status

Measured 2026-09-22 on an M5 Air (16 GB), all through this gateway:

- Public JevBench, full auto routing: 174 / 231 (easy 48/48, original
  68/72, hard 58/111), 0 errors
- Same fixture, SemIf-only equivalent: 48/48 easy; auto routing trades
  2 easy items (Laya fast-path misses) for ~14 ms answers on compact
  inputs vs ~205 ms on SemIf
- Laya direct, easy only: 41 / 48 at p50 14 ms; 3 requests refused by
  its 96-token input cap

See [architecture notes](docs/architecture.md) and
[provider evaluations](docs/provider-evaluations/) for method and caveats.
