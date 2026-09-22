# Architecture notes

## Design rule

Routing must be deterministic and cheap. The gateway must not call an LLM merely to decide which LLM should answer.

## Route policy

The first release has one quality provider: the configured local llama.cpp model. This avoids semantic regex routing and avoids presenting model capability differences as API behavior.

An optional fast provider may be added later only through a versioned task
profile. A profile is a deterministic request matcher and a provider-specific
admission rule, both covered by a labeled evaluation set for that task. It is
not a global confidence threshold.

Every fast-provider profile requires all of the following:

1. A deterministic, inspectable request matcher; no model is called merely to
   select a route.
2. A fixed input-capacity rule.
3. A labeled task-specific evaluation showing both accuracy and the error rate
   among requests admitted by its confidence/margin rule.
4. Clear observability of provider, profile, route reason, and fallback/error
   state.

The initial profile registry is empty. Until a profile is validated, every
request stays on the quality provider.

## Failure policy

- Invalid Jev request: 422 with a stable API error object.
- llama.cpp unavailable, model missing, or capacity exceeded: 503.
- Invalid model output: 502.

The gateway never returns a fabricated decision or an undisclosed heuristic fallback.

## Observability

Every successful response should include provider name, model identifier, input size, decode latency, and route reason. Request content must not be logged by default.
