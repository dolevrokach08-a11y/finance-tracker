# Finance Tracker — conventions for the design agent

This is a **Hebrew, RTL, dark-first** personal-finance web app (vanilla HTML/CSS — no framework). Everything you design must be implementable as plain HTML + CSS custom properties.

## Setup that must not be skipped
- `html { direction: rtl }` on every design. Hebrew is the primary language.
- **Numbers, percentages and currency amounts must be LTR-isolated** or plus signs and currency symbols render reversed. Use the provided `.num` class (`direction:ltr; unicode-bidi:isolate; tabular-nums`). Example: `<span class="num">+3.7%</span>`.
- Dark theme is the default (`:root` tokens). Light theme = the same tokens redefined under `[data-theme="light"]` — never hard-code colors for either theme.

## Styling idiom: CSS custom properties only
No utility-class framework exists. Style with the tokens from `tokens/theme.css` via `var(--*)`:

- **Surfaces:** `--bg-base` (page), `--bg-surface` / `--card-bg` (cards), `--bg-elevated`, `--bg-hover`
- **Text:** `--text-primary`, `--text-secondary`, `--text-muted`
- **Brand accent (green):** `--accent`, `--accent-dim` (subtle fills), `--accent-hover`, `--accent-secondary` (blue)
- **Finance semantics (never repurpose):** `--profit` (green) and `--loss` (red) mean money gained/lost ONLY. Neutral chart categories use `--blue`, `--purple`, `--teal`, `--amber`. `--warning`, `--info`, `--success`, `--danger` for status.
- **Borders & radii:** `--border`, `--border-accent`; `--radius-sm|md|lg|xl` (8/12/16/20px)
- **Elevation:** `--shadow-xs` … `--shadow-xl`, `--shadow-accent`
- **Motion:** `--transition`, `--transition-fast`, `--duration-fast|normal|slow`, `--ease-default|spring`

Helper classes shipped in `styles.css`: `.card` (surface + border + radius + shadow), `.num` (LTR numbers), `.profit`, `.loss`.

## Where the truth lives
- `styles.css` → imports `tokens/theme.css` (the full 100+ token set, both themes). Read it before styling.
- `guidelines/design-brief.md` — the active redesign brief: what to build, what to preserve.
- `guidelines/design-spec-phase4a.md` — 15 audited defects of the current UI; never reproduce them (fake sparklines, dash-only empty states, 4 unexplained return figures, reversed plus signs).

## Idiomatic snippet (a KPI card)
```html
<div class="card" style="padding:16px">
  <div style="color:var(--text-muted); font-size:12px">תשואת התיק</div>
  <div class="num profit" style="font-size:28px; font-weight:700">+3.7%</div>
  <div style="color:var(--text-secondary); font-size:12px">תשואה משוקללת־זמן (TWR) · 1.3 שנים</div>
</div>
```

---

## Project contents (lite sync — tokens + guidelines, no component library)

| Path | What |
|---|---|
| `styles.css` | Entry stylesheet: imports the tokens, sets RTL/dark ground, ships `.card` `.num` `.profit` `.loss` |
| `tokens/theme.css` | The app's full token set — dark (`:root`) + light (`[data-theme="light"]`) |
| `guidelines/design-brief.md` | The active redesign brief (screens, priorities, constraints) |
| `guidelines/design-spec-phase4a.md` | Audit of the current UI — 15 defects the redesign must fix |

Synced from the `finance-tracker` repo (vanilla HTML app). The app has no component library; designs should be buildable as plain HTML+CSS using these tokens.
