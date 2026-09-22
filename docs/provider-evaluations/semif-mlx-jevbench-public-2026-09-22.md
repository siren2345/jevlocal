# SemIf MLX direct scoring on JevBench public split — 2026-09-22

## Decision

Adopt SemIf on MLX/Qwen3.5-4B as the initial quality-default provider.
This is not a claim that it matches Jev, nor an official JevBench submission:
the run contains only the 231 public items. Private JevBench items were not
used locally.

## Environment

- MacBook Air M5, 16 GB unified memory; macOS 27.0 arm64
- SemIf commit `1f2dea3e25379f9dfc98cb83c324f00ab5deda37`
- `Qwen/Qwen3.5-4B` revision `851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a`
- MLX direct readout, in-memory affine 4-bit quantization, 256 MiB cache cap
- Laya ANE provider remained loaded while SemIf ran

## Result

| Public cohort | Correct | Accuracy | p50 | p95 |
| --- | ---: | ---: | ---: | ---: |
| easy | 48 / 48 | 100.0% | 204 ms | 256 ms |
| standard | 68 / 72 | 94.4% | 206 ms | 265 ms |
| hard | 65 / 111 | 58.6% | 807 ms | 4,942 ms |
| all public | 181 / 231 | 78.4% | 265 ms | 4,761 ms |

The `noul` comparison maps SemIf's internal `true`/`false` option IDs back to
the JevBench `yes`/`no` labels before scoring. The run used JevBench's own
published SemIf conversion: option descriptions are prefixed with their
declared option IDs, and Score is an extension over ordered score levels.

## Interpretation

- Short typed decisions are a strong fit for direct readout.
- Long public hard items dominate tail latency and lower accuracy; they must
  not be sent to Laya based on a confidence threshold.
- This establishes SemIf as the comparison baseline for the gateway. It does
  not establish calibration: direct option scores are conditional on the
  declared options and need per-workload calibration before confidence-driven
  escalation is enabled.

## Reproduction shape

Use the public `easy.jsonl`, `original.jsonl`, and `hard.jsonl` files from
the JevBench repository. Convert each task through the mapping documented in
`jevbench/adapters/semif_direct.py`, invoke `semif-score --backend mlx --mode
direct`, then compare the selected option with the public expected label. Do
not tune prompts or route profiles against the private split.
