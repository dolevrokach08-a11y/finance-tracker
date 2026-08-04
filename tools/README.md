# tools/

Build helpers for the two files in this repo that are **generated and committed**.

The app has no build step and GitHub Pages deploys `main` as-is, so the outputs
have to live in the repo. What changed is only that two files now have a source
file that produces them.

## Setup (once per clone)

```sh
npm --prefix tools install
git config core.hooksPath tools/hooks
```

The second line arms a pre-commit hook that refuses a commit when a generated
file is stale. It is per-clone local config — a fresh clone has no protection
until you run it.

## Usage

```sh
node tools/build-assets.mjs           # rebuild the generated files
node tools/build-assets.mjs --check   # verify freshness (what the hook runs)
```

## What is generated

| Source | Output | Notes |
|---|---|---|
| `tax-optimizer.src.jsx` | `tax-optimizer.app.js` | JSX → `React.createElement`. Replaced babel-standalone (~2.7MB) transpiling in the browser on every page load. |

Each output starts with a header naming its source and that source's sha256.
`--check` recomputes the hash and compares.

## Things worth knowing

- **Edit the source, never the output.** The header says so too, but the failure
  is quiet: your edit to `tax-optimizer.app.js` survives until the next build and
  then vanishes.
- **`@babel/preset-react` runs in `classic` runtime**, not `automatic`. The page
  loads React and ReactDOM as UMD globals via `<script>` tags; the automatic
  runtime would emit `import { jsx } from "react/jsx-runtime"` and nothing would
  render. Babel is also handed the preset as an imported value rather than a
  string name, because it resolves string names relative to the file being
  compiled — the repo root, where `tools/node_modules` isn't visible.
- **The repo-root `package.json`, `vite.config.js`, `package-lock.json` and
  `run-dev.cmd` are local dev setup and must never be modified or staged.** That
  is why this is a separate self-contained sub-package, mirroring `scripts/`.
- **The ergonomic cost is real:** the tax page is no longer editable by opening a
  single file. That was accepted deliberately in exchange for deleting an
  in-browser JIT compiler from every page load.

## Verifying the Tailwind swap

```sh
node tools/check-tailwind-coverage.mjs
```

Lists every Tailwind-looking class used in `finance.html` that has no rule in
the generated stylesheet. This is the failure mode that matters: a missing
utility produces a layout break, not an error, so nothing else catches it. Run
it after any edit that adds classes to that page.

One non-obvious thing it handles: Tailwind escapes special characters in
selectors, so `md:grid-cols-2` is `.md\:grid-cols-2` in the CSS and `py-0.5` is
`.py-0\.5`. A naive search reports 23 false positives.

## Cascade position

`finance.tailwind.css` is linked at the **end** of `<head>`, not where the CDN
`<script>` was. The Play CDN injected its stylesheet at runtime, which landed it
after every block in the head, so Tailwind's preflight won over the page's own
rules — `body { line-height: 1.6 }` was being overridden to `inherit` (24px, not
25.6px). Linking it in the script's old position silently changed line-height on
every element. Don't move it.

## vendor/ — self-hosted libraries

Every third-party library except tesseract.js is served from `vendor/` with the
version in the filename. That naming is load-bearing: the service worker serves
everything under `vendor/` **cache-first with no revalidation**, which is only
safe because a new version is a new URL.

```sh
node tools/update-vendor.mjs --dry-run   # what's out of date
node tools/update-vendor.mjs             # apply, rewrite refs, bump sw.js
```

`vendor/manifest.json` is the source of truth — npm package, version, path in
the package, output filename, and every file that references it. The updater
rewrites all of them and bumps `SHELL_CACHE`.

`.github/workflows/vendor-update.yml` runs this weekly and **opens a PR**. It
never merges. There are no tests here, so the only thing that verifies a bump is
a person loading the page with real data — and the very first dry run offered
React 19, which removes the `ReactDOM.render` call the tax page is built on.

Two pins that must not drift:
- **chart.js 3.9.1** for finance.html — 18 chart configs written against the v3
  API. `pinMajor: 3` in the manifest keeps the updater on that line.
- **tesseract.js stays on the CDN.** Its entry point pulls a ~4MB wasm core and a
  ~10MB+ Hebrew model at runtime; hosting it means ~15MB of binaries in git and
  hand-maintained `corePath`/`langPath`. It loads on demand, so it costs nothing.
