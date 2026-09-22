# jevlocal-mac

A macOS-local gateway that exposes a Jev-compatible typed-decision API and routes requests to locally installed decision providers.

The default quality provider is SemIf's direct option-logit readout over Qwen3.5-4B on MLX. Laya Core ML may be admitted as an ANE fast path only for explicitly enabled, task-specific profiles. jevlocal-mac owns API compatibility, request validation, result normalization, and deterministic provider routing.

## Scope

The compatibility promise is limited to the public HTTP interface:

- POST /v1/systemone and POST /v1/decide
- Jev-shaped choice, noul, and score request/response schema
- Choice criteria keys preserved exactly

It does not claim to reproduce TypeSafe Jev's model, probabilities, context behavior, or algorithms.

## Architecture

    client
      -> jevlocal-mac gateway (loopback)
          -> validation and schema normalization
          -> deterministic route selection
          -> SemIf provider (loopback, MLX / Qwen3.5-4B)
          -> Laya Core ML ANE (only an enabled fast profile)

The quality route never silently falls back to an unvalidated heuristic. Laya is
not selected from its confidence alone: a caller must identify a profile that
has been independently evaluated for Laya admission.

## Quick start

- Apple Silicon Mac
- Node.js 20+
- Homebrew

Install SemIf into a dedicated Python environment. The SemIf source is pinned
here because its MLX backend and direct prompt are part of the provider's
behavior.

```bash
git clone https://github.com/TheoLeeCJ/SemIf.git vendor/SemIf
git -C vendor/SemIf checkout 1f2dea3e25379f9dfc98cb83c324f00ab5deda37
python3.12 -m venv .venv-semif
.venv-semif/bin/pip install -e 'vendor/SemIf[mlx]'
```

In one terminal, start SemIf on loopback. Its first request downloads the
pinned Qwen3.5-4B checkpoint and quantizes it in memory to 4-bit MLX weights.

```bash
JEVLOCAL_PORT=9013 .venv-semif/bin/python providers/semif_server.py
```

Start the Laya Core ML loopback service on port 9012 if you have an evaluated
fast profile. Otherwise omit it; all requests stay on SemIf.

In a second terminal, start the gateway:

```bash
JEVLOCAL_PROVIDER=cascade npm start
```

The gateway listens at `http://127.0.0.1:9011`. Configure a different local
provider URL with `JEVLOCAL_SEMIF_URL` or `JEVLOCAL_LAYA_URL`, or a different
gateway port with `JEVLOCAL_PORT`.

## Current API

`POST /v1/systemone` and `POST /v1/decide` accept a JeV-shaped request. The
gateway accepts string or JSON-object `state` and `instructions`, preserving
structured inputs by serializing them into the local model prompt.

```json
{
  "model": "jev-latest",
  "state": { "ticket": "The customer was charged twice." },
  "questions": {
    "route": {
      "type": "choice",
      "instructions": { "task": "Choose the support team." },
      "criteria": {
        "billing": "Payment or duplicate charge issue",
        "technical": "Application malfunction"
      }
    }
  }
}
```

`choice` accepts 1–26 criteria and preserves the caller's criterion keys.
`noul` is evaluated as false/true, and `score` supports 2–10 ordered levels.
SemIf supports up to 16 options, so a 17–26 option question receives a clear
422 response from that provider rather than a silently truncated decision.
Its probabilities are conditional native option-logit scores, not calibrated
Jev probabilities.

Run the no-model unit checks with:

```bash
npm test
```

## Provider routing

`JEVLOCAL_PROVIDER=semif` is the default and sends every request to SemIf.
`JEVLOCAL_PROVIDER=cascade` enables Laya only when the caller includes a
`routing_profile` (or `metadata.routing_profile`) whose name is present in
`JEVLOCAL_LAYA_PROFILES`. If Laya is unavailable, that request falls back to
SemIf. The default profile set is empty deliberately.

For example, this enables a profile named `support-intent-v1` after it has a
labeled admission evaluation:

```bash
JEVLOCAL_PROVIDER=cascade \
JEVLOCAL_LAYA_PROFILES=support-intent-v1 \
npm start
```

The public JevBench measurement is the primary compatibility benchmark; BBQ
and 2048 remain focused diagnostic and integration tests. See
[architecture notes](docs/architecture.md).

## Generated-provider compatibility mode

| Jev type | Internal decode |
| --- | --- |
| `JEVLOCAL_PROVIDER=generated` | llama.cpp constrained A–Z decoding |
| `JEVLOCAL_PROVIDER=semif` | MLX direct option logits |
| `JEVLOCAL_PROVIDER=cascade` | explicit Laya profile, otherwise SemIf |

The generated mode remains a comparison provider; it is not the default route.

## Status

SemIf is the quality default. The next milestone is to define and validate
real Laya admission profiles without optimizing solely for public JevBench
items.

See [architecture notes](docs/architecture.md) and the
[provider evaluations](docs/provider-evaluations/) for reproducible local
results and provider admission decisions.
