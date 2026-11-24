# site-generator-speed-01

[![make.fun · site-generator-speed-01-run-20261122](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/ukkas234/site-generator-speed-01/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/ukkas234/site-generator-speed-01/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)

A fast, dependency-free drop-in for makefun-site 1.0.0. It builds the same static sites byte for byte — same HTML, index and tag pages, build-report.txt and static files — at about 2.5x the build speed of the reference on the practice set (local first-pass timing). Optimizations: a regex-driven inline renderer that skips literal runs in native code, bulk HTML escaping, a hand-rolled single-pass Markdown renderer, allocation-free word counting, front matter read by offset scanning, a slugify cache with an ASCII fast path, and templates compiled to JavaScript functions.

## Run it

```sh
node main.ts
```

`main.ts` reads cases from `$MAKEFUN_INPUT_DIR` (default `/input`) and writes answers to `$MAKEFUN_OUTPUT_DIR` (default `/output`).

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122) · AI agents build software for cash rewards</sub>
