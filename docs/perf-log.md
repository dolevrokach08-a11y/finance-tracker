# Page-load performance log (Phase 5)

Numbers come from `tools/perf/probe.js` run against the **deployed** site
(`https://dolevrokach08-a11y.github.io/finance-tracker/`). Never measure vite —
dev serves unminified and uncompressed, so byte counts are meaningless there.

## What is and isn't measurable here

Two limits found while taking the baseline, worth knowing before reading any row:

- **Cross-origin bytes are opaque.** jsDelivr, unpkg, cdnjs, gstatic and Google
  Fonts don't send `Timing-Allow-Origin`, so `transferSize`/`decodedBodySize`
  come back as `0` in the Resource Timing API. Third-party weight therefore has
  to be reasoned about from known library sizes, not measured from the page.
  `decodedTotal` below counts **same-origin only**.
- **FCP/LCP need a foreground tab.** Chrome doesn't emit paint timings for a
  backgrounded tab, and the automation drives a background tab, so those columns
  are blank. `dcl` / `load` / `ttfb` are unaffected and are what we track.

The reliable, comparable KPIs are: **request count**, **blocking script count**,
**same-origin decoded bytes**, and **DCL / load**.

## Baseline — commit `6e203b2`, SW cache v27 (2026-08-04)

Owner's real account, logged in, no throttling applied.

| page | profile | ttfb | dcl | load | reqs | blocking scripts | doc decoded |
|---|---|---|---|---|---|---|---|
| index.html | cold (SW+caches cleared) | 221 | 1142 | 1382 | 26 | 3 | 73,091 |
| portfolio.html | warm (SW active) | 67 | 2301 | 2782 | 57 | 8 | 841,938 |

`index.html` cold transferred 16,969 bytes for a 73,091-byte document — GitHub
Pages gzip is doing ~4.3x, so `portfolio.html`'s 842KB document is roughly
190KB over the wire. The parse and execute cost of those 842KB is not
compressible, and it is paid on every navigation to the page.

### The 8 blocking scripts on portfolio.html

Every one of these delays first paint. This list is the direct target of batch 1
(defer) and batch 3 (lazy-load):

```
cdn.jsdelivr.net/npm/chart.js@4.5.1
unpkg.com/lucide@1.17.0
shared/user-storage.js
shared/data.js
cdnjs.cloudflare.com/.../xlsx.full.min.js     ← ~900KB, used by one hidden file input
sync-widget.js
ai-assistant.js                                ← ~96KB, consumer runs at load+500ms
terms-modal.js
```

## After batch 1 — commit `b98eaff`, SW cache v28

`portfolio.html`, warm, 3 reloads, **median**:

| metric | baseline | after batch 1 | change |
|---|---|---|---|
| DCL | 2301 | **1490** | −35% |
| load | 2782 | **1982** | −29% |
| requests | 57 | 46 | −11 |
| blocking scripts | 8 | 0 | −8 |

Individual samples were 2612 / 1490 / 811 ms DCL. The 2612 outlier is the load
immediately after the SW swapped to v28 and purged the cache — effectively a
cold load, not a warm one. Best warm sample: DCL 811ms, load 1290ms.

**Read these timings as directional, not precise.** No throttling is applied, the
network is live, and Firestore/Yahoo latency varies per load, so the spread
between samples (811–2612) is wider than the effect we are measuring. The
counted metrics — requests, blocking scripts — are exact and are the ones to
trust. This is why the protocol says median of three.

Probe note: the `blockingScripts` selector counts `<script type="module" src>`,
which is deferred by default. `portfolio.html` reports 1 for `terms-modal.js`
but is really at 0.

## After batch 3 — commit `d6543af`, SW cache v31

`finance.html`, warm:

| metric | value |
|---|---|
| DCL | 1345 |
| load | 1617 |
| requests | 24 |
| served from cache | 15 |
| `Chart` / `XLSX` / `d3` at load | **all undefined** |

`finance.html` was never measured at baseline, so there is no before/after row
for it — the meaningful check here is the last one: the three libraries that used
to block every visit (~1.3MB combined) are now absent until something needs them,
and the fake `XLSX`/`Chart` stubs are gone with them.

Blocking scripts remaining: `finance.html` has Tailwind's CDN (batch 5);
`tax-optimizer.html` has React, ReactDOM and babel-standalone (batch 4). The
other three pages are at zero.

## After batch 4 — commit `3940800`, SW cache v33

`tax-optimizer.html`, warm, real account (47 payslips, 3 tax years):

| metric | value |
|---|---|
| DCL | **331** |
| load | **386** |
| requests | 30 |
| `Babel` at load | **undefined** |

This is the largest single win in the plan. ~2.7MB of babel-standalone and the
in-browser transpilation of 2,139 lines of JSX are gone from every visit; the
compiled `tax-optimizer.app.js` is 148KB.

Two things surfaced during verification, both recorded in the commits:

- The compiled script is deferred where the babel block ran during parse, which
  reversed an ordering the page relied on — the auth block could call
  `__renderApp()` before it existed, and the existing guard turned that into a
  blank page with no error. Fixed with a two-sided `__appReady` handshake.
- The page rendered blank against the real account because a Firestore read
  stalled and there was no time limit on it. Pre-existing — the old code awaited
  at the same point — and unlike the other pages this one has neither a getDoc
  timeout nor a localStorage fallback. Both reads are now raced against 10s.

## After batch 5 — commit `b3fda6f`, SW cache v35

`finance.html`, warm — the page the owner reported as slowest to open:

| metric | after batch 3 | after batch 5 |
|---|---|---|
| DCL | 1345 | **961** |
| load | 1617 | **1087** |
| requests | 24 | 27 |
| blocking scripts | 2 | **1** (the 1KB loader) |

The Play CDN is gone; `finance.tailwind.css` (198KB) is built ahead of time.
`body` line-height is 24px, matching the CDN exactly — see the commit for why
cascade position decided that, and `tools/README.md` for why the link must stay
at the end of `<head>`.

Coverage check: 0 of the 160 Tailwind utilities used in the page are missing from
the generated stylesheet (`node tools/check-tailwind-coverage.mjs`).

### Two findings that are not about our code

- **An Adobe Acrobat Chrome extension** (`efaidnbmnnnibpcajpcglclefindmkaj`)
  injects ~13 extra script and font requests into every page load, including two
  `.otf` font files. It is part of the owner's felt slowness but nothing in this
  plan will fix it — disabling the extension is the only lever.
- **Firestore `Listen/channel` returned 503 twice** during the portfolio load
  (requests 54 and 56 of 57). Long-polling is already the slower transport by
  design (`experimentalForceLongPolling`, required by the Netspark filter); 503s
  on top of that add retry latency to the very calls that gate first paint.
  Worth watching — if it is reproducible it belongs in its own investigation,
  not in this performance plan.
