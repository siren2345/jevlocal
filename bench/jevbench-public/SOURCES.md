# bench/jevbench-public sources

Public-only JevBench fixture (231 decisions: 48 easy, 72 original,
111 hard). Item content is MIT-licensed per each record's `provenance`.

- Upstream: https://github.com/fstandhartinger/jevbench
- Commit: `75e6224ed8103bbc3485ca74820a2eaf7ce8abe0` (v1.3.0)
- Files: `datasets/public/{easy,original,hard}.jsonl`, copied unchanged.

SHA256 (must match upstream):

- easy.jsonl: `231df3c2c8e88a1a8c137ebe85de96ba70fabd330849098ac7b3c52c70b7172b`
- original.jsonl: `5c2414edb3006b8bfcb70fda433f0f9ca015759433849f8d3104328a1f7c4180`
- hard.jsonl: `89e9e6becb33ed88c1de7d42dcc87531b2fb64cfaef4e1986faf7c37b3f80ebb`

The private JevBench split is deliberately absent. Never add it here;
never tune prompts or route profiles against it.
