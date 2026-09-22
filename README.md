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

## Requirements

- Apple Silicon Mac
- A local Metal-enabled llama-server
- A compatible GGUF model stored locally
- Python 3.11+ for the gateway

The first supported profile will target a Qwen-class 4B model quantized for local inference. The exact model, quantization, context budget, and measured M-series performance will be pinned and documented before the first release.

## Planned request mapping

| Jev type | Internal decode |
| --- | --- |
| choice | One A-Z token, mapped back to the caller's criteria key |
| noul | One A/B token representing false / true |
| score | One A-J token representing score levels |

Only models that can emit the option label as their first visible output token are suitable for this runtime. Models configured to emit hidden reasoning before an answer are not compatible with single-token decoding.

## Status

Repository initialization only. The next milestone is a reproducible local llama.cpp + Qwen installation, followed by API-contract tests and accuracy/latency measurements on this Mac.

See [architecture notes](docs/architecture.md) and the
[provider evaluations](docs/provider-evaluations/) for reproducible local
results and provider admission decisions.
