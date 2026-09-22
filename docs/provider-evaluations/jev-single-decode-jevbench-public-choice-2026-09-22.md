# jev-single-decode on JevBench public Choice — 2026-09-22

## Scope

This is a direct comparison with SemIf on the 139 public JevBench tasks whose
type is `choice`. `jev-single-decode` does not implement `noul` or `score`, so
it cannot be scored over the full 231-item public fixture or serve as the
gateway's complete quality provider.

## Configuration

- `siren2345/jev-single-decode` commit `8100289`
- `Qwen3.5-4B-Q4_K_M.gguf` on llama.cpp Metal
- Adapter single-token, grammar-constrained A-Z output with its own
  `post_sampling_probs` / logit-bias probability extraction
- Serial local HTTP requests; model warm before the measured run

## Result

| Provider | Correct | Accuracy | p50 | p95 | ECE |
| --- | ---: | ---: | ---: | ---: | ---: |
| jev-single-decode | 47 / 139 | 33.8% | 785 ms | 7,896 ms | 0.265 |
| SemIf MLX Q4 | 109 / 139 | 78.4% | 266 ms | 4,806 ms | — |

Single-decode had complete schema coverage (139/139) but is substantially
less accurate and slower in this configuration. Its public choice result is
not comparable with the repository's README BBQ result: that was Qwen3-4B on
an RTX 5090 under a different BBQ fixture and 20-way concurrency.

## Interpretation

This does **not** establish that a one-token decode is intrinsically weak. It
does establish that the current adapter's llama.cpp post-sampling probability
path, prompt construction, or its interaction with Qwen3.5 Q4 Metal is not a
quality-provider candidate. Do not route production requests to it.

Any future repair must be evaluated first on this unchanged Choice fixture,
then on the full JevBench types after adding `noul` and `score` support.
