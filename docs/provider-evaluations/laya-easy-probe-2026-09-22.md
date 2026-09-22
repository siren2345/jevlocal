# Laya direct probe on JevBench easy — 2026-09-22

## Scope

Probe, not an admission decision. Ran the in-repo runner against Laya
directly (`:9012`, no gateway) on the easy cohort only, to collect
capacity evidence for a future task profile (handoff item 3).
Artifacts: `results/jevbench-public/laya-easy-probe/` (gitignored).

## Result

41 / 48 correct (85.4%), p50 13.8 ms, p95 35.1 ms. Errors: 3.
Misses: 2 choice + 2 noul.

## Findings

- The 3 errors are legitimate capacity rejections, not flakes:
  `Input has 99 tokens, but this export supports at most 96`.
  Even easy items exceed the ANE 96-token cap once state + instructions
  + criteria are tokenized. A rerun of the same 3 items still 503s warm.
- Through the gateway this shape is already handled: cascade falls back
  to SemIf when an admitted Laya request fails. Direct `:9012` callers
  get the raw 503.
- Speed is the attraction (14 ms vs SemIf's ~205 ms on the same
  cohort), but the cap means any Laya profile must freeze an input
  budget *below* 96 tokens with measured headroom, plus a labeled
  holdout — exactly the route rule already recorded. No new profile
  admitted by this probe.
