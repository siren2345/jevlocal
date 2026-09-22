# Architecture notes

## Design rule

Routing must be deterministic and cheap. The gateway must not call an LLM merely to decide which LLM should answer.

## Initial route policy

The first release has one quality provider: the configured local llama.cpp model. This avoids semantic regex routing and avoids presenting model capability differences as API behavior.

An optional fast provider may be added later only with all of the following:

1. An explicit caller-selected profile, without changing the Jev JSON schema.
2. A fixed input-capacity rule.
3. Task-specific accuracy and latency measurements.
4. Clear observability of provider, route reason, and fallback/error state.

## Failure policy

- Invalid Jev request: 422 with a stable API error object.
- llama.cpp unavailable, model missing, or capacity exceeded: 503.
- Invalid model output: 502.

The gateway never returns a fabricated decision or an undisclosed heuristic fallback.

## Observability

Every successful response should include provider name, model identifier, input size, decode latency, and route reason. Request content must not be logged by default.
