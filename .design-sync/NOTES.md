# design-sync notes — finance-tracker

- 2026-07-08 first sync ("lite"): this repo is a vanilla-HTML app with NO component library, so the standard converter path does not apply. Uploaded surface (6 files): styles.css (hand-authored entry importing the tokens + `.card`/`.num`/`.profit`/`.loss` helpers), tokens/theme.css (verbatim copy of shared/theme.css — 100+ vars, dark `:root` + light `[data-theme="light"]`), guidelines/ (docs/claude-design-brief.md + docs/design-spec-phase4a.md), README.md (conventions header + index).
- Re-sync procedure: re-copy shared/theme.css → ds-bundle/tokens/theme.css and docs/*.md → ds-bundle/guidelines/, re-validate conventions.md names against them, re-upload the same 5 content files (sentinel-fenced). No anchor (_ds_sync.json) is written — intentional for this tiny surface.
- If the app ever grows a real component library (or the Phase 4b redesign produces reusable components), redo a full sync — the lite project can then be superseded.
- conventions.md names validated 2026-07-08 against shared/theme.css + ds-bundle/styles.css — all token/class names exist.
