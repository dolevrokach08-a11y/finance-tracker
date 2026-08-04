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
