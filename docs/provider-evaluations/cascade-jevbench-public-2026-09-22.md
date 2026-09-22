# Cascade gateway on JevBench public split — 2026-09-22

## Scope

First run of the in-repo runner (`scripts/run-jevbench-public.mjs`) over
the vendored public fixture (`bench/jevbench-public`, 231 decisions).
Target was the cascade gateway (`:9011`, empty `laya_profiles`, so every
request reached SemIf MLX on `:9013`). Artifacts:
`results/jevbench-public/cascade-2026-09-22/` (gitignored).

## Result

| Cohort | Correct | Accuracy | p50 | p95 |
| --- | ---: | ---: | ---: | ---: |
| easy | 48 / 48 | 100.0% | 205 ms | 262 ms |
| original | 68 / 72 | 94.4% | 205 ms | 264 ms |
| hard | 58 / 111 | 52.3% | 884 ms | 5,651 ms |
| all public | 174 / 231 | 75.3% | 264 ms | 5,106 ms |

Errors: 0 / 231.

## Comparison with the direct CLI run

The earlier `semif-score --mode direct` run on the same weights scored
181 / 231 (hard 65 / 111). The gateway path scores 7 fewer hard items.
Easy and original cohorts match exactly.

A same-process rerun of the hard cohort flips 0 / 111 predictions, so the
gateway path is deterministic and the gap is a systematic pipeline
difference, not sampling noise. Candidates, unranked:

- noul option order: the gateway sends `false`/`true`, JevBench's
  `semif_direct` conversion sends `true`/`false`.
- In-memory 4-bit quantization is per-process; the CLI run and the
  long-lived `:9013` server quantized separately.
- Hard misses concentrate in `long_policy`, `temporal_numeric`,
  `judge_hard`, and `tradeoff` families (53 misses: 30 choice,
  19 noul, 4 score), i.e. long states and close calls where small
  logit shifts flip the argmax.

This does not change the provider decision: SemIf remains the quality
default, and the runner is now the baseline instrument. Resolving the
7-item gap (e.g. aligning noul order, testing fresh-quantization
variance) is follow-up work, not a blocker.
