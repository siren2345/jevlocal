# Laya ANE + Qwen cascade evaluation — 2026-09-22

## Decision

Do not add a global Laya confidence gate. Laya's margin is useful for some
compact, task-specific decisions, but it is not a portable estimate of answer
correctness. A fast route must be registered and validated per task profile.

## Co-residency

The following ran concurrently on the M5 Air with 16 GB unified memory:

- Laya Core ML ANE bundle (`cpu_ne`)
- Qwen3-4B-Q4_K_M through llama.cpp Metal

After both were loaded, system-wide memory free was 23%. Laya's first inference
took 17.7 s to compile/load Core ML. Warm calls on the 82-token 2048 fixture
took 5.4–6.1 ms server-side (the first warm HTTP call was 54.5 ms).

## Small routing slice

On five short, labeled support-ticket decisions, Laya ANE answered four
correctly. The one miss (`pricing`) had a 0.4014 confidence margin; the four
correct answers had margins of 0.8994 or greater. With a 0.5 threshold, that
case was retried through the Qwen gateway and became correct in 477 ms, while
the four high-margin cases stayed on ANE in roughly 6–10 ms.

This is encouraging but is only five examples. It cannot establish a generic
threshold.

## Counterexample: compact BBQ

The BBQ-100 questions were converted to compact typed decisions by putting the
passage in `state`, the question in `instructions`, and retaining the three
answer strings as criteria. Laya's own tokenizer admitted 96 of 100 requests
within the ANE's 96-token limit.

| Admission | Cases | Accuracy |
| --- | ---: | ---: |
| All ANE-admitted | 96 | 24.0% |
| Confidence >= 0.25 | 29 | 24.1% |
| Confidence >= 0.50 | 0 | — |

This does not contradict the compact ticket result: it shows that margin and
accuracy are task-dependent. It also means that a generic rule such as "short
request plus high confidence means Laya" would be unjustified.

## Route rule going forward

1. Start with the quality provider.
2. Add Laya only for a named task profile with a labeled holdout set.
3. Freeze its input cap and margin threshold from the holdout set.
4. Log the profile and route reason; fall back to the quality provider when the
   profile does not admit a request.

The Laya experiment is preserved separately in
`siren2345/jevlocal-coreml-experiment`; its old Foundation Models fallback is
an experimental reference, not the new gateway's implementation.
