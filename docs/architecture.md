# Architecture notes

## Design rule

Routing must be deterministic and cheap. The gateway must not call an LLM
merely to decide which provider should answer, and it must not use model
confidence as a general quality gate: both were shown task-dependent.

## Route policy

There is one fixed pipeline and no provider configuration. SemIf on MLX
is the quality default. A compact single-choice question is tried on the
Laya ANE fast path first; anything else, and any fast-path failure, is
answered by SemIf. The admission test is a pure function of the request
in `server.mjs` (`admission`): one question, choice type, at most 8
options, no reasoning-shaped text, roughly 72 tokens or less. The 72 is
75% of the ANE 96-token export limit against a chars/4 estimate, leaving
headroom for tokenizer differences; over-cap requests fail safe to SemIf
because Laya itself rejects them and the gateway retries there.

Tightening or widening admission is done by us from measurements, never
by caller configuration. The runner (`scripts/run-jevbench-public.mjs`)
is the instrument for that.

## Failure policy

- Invalid Jev request: 422 with a stable API error object.
- SemIf unavailable: 503. Laya unavailable or over capacity on an
  admitted request: automatic SemIf retry; only a SemIf failure
  surfaces as 503.
- Invalid model output: 502.

The gateway never returns a fabricated decision or an undisclosed
heuristic fallback.

## Observability

Every successful response includes the producing provider and the route
reason in `metadata`. Request content must not be logged by default.
