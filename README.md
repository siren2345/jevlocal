# jevlocal-mac

A macOS-local gateway that exposes a Jev-compatible typed-decision API and routes requests to a locally installed LLM runtime.

The initial target is a llama.cpp server using Metal and a GGUF Qwen-class model. jevlocal-mac owns API compatibility, request validation, option-label encoding, result normalization, and deterministic provider routing. The model runtime owns model loading and inference.

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
          -> option labels A-Z / one-token decode
          -> llama.cpp server (loopback, Metal)
          -> local GGUF model

The default quality route will use the local causal LLM. A future fast route may use an explicitly selected, independently evaluated provider. It will never silently substitute a heuristic or a lower-quality model.

## Quick start

- Apple Silicon Mac
- Node.js 20+
- Homebrew

Install llama.cpp and download the pinned first provider:

```bash
brew install llama.cpp
mkdir -p models
curl -fL -o models/Qwen3-4B-Q4_K_M.gguf \
  https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf
```

In one terminal, start the Metal runtime on loopback. Do not expose this port
to the network.

```bash
llama-server -m models/Qwen3-4B-Q4_K_M.gguf \
  --host 127.0.0.1 --port 9030 --ctx-size 8192 \
  --n-gpu-layers all --reasoning-format none --no-webui
```

In a second terminal, start the JeV gateway:

```bash
npm start
```

The gateway listens at `http://127.0.0.1:9011`. Configure a different local
runtime with `LLAMA_URL` and `LLAMA_MODEL`, or a different gateway port with
`JEVLOCAL_PORT`.

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
All are a constrained, greedy one-token decode. Returned probabilities are
therefore one-hot decisions, not calibrated confidence estimates.

Run the no-model unit checks with:

```bash
npm test
```

## Provider profile

The first supported profile is Qwen3-4B-Q4_K_M on llama.cpp Metal. On this M5
Air (16 GB), it scored 71% on the local BBQ-100 evaluation, with a 122 ms p50
per one-token decision and about 3.9 GB warm server RSS. See the evaluation
documents for method and caveats.

## Planned request mapping

| Jev type | Internal decode |
| --- | --- |
| choice | One A-Z token, mapped back to the caller's criteria key |
| noul | One A/B token representing false / true |
| score | One A-J token representing score levels |

Only models that can emit the option label as their first visible output token are suitable for this runtime. Models configured to emit hidden reasoning before an answer are not compatible with single-token decoding.

## Status

The initial Qwen quality route is implemented. The next milestone is a
mechanical router that adds an independently validated fast route without
changing callers' JeV schema.

See [architecture notes](docs/architecture.md) and the
[provider evaluations](docs/provider-evaluations/) for reproducible local
results and provider admission decisions.
