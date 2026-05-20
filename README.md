# Finance Tracker

אפליקציית ווב פרטית לניהול פיננסי אישי — מעקב הכנסות/הוצאות, תיק השקעות, אופטימיזציית מס, וניתוח משכנתא. רצה כ-PWA, נתונים מסונכרנים ל-Firebase.

## מודולים

| קובץ | תיאור |
|---|---|
| `index.html` | דשבורד ראשי |
| `finance.html` | מעקב הכנסות/הוצאות, קטגוריזציה, דוחות, מעשרות |
| `portfolio.html` | תיק השקעות — מניות, אג"ח, פנסיות, TWR/MWR |
| `mortgage.html` | חישובי משכנתא ותרחישי credit-cliff |
| `tax-optimizer.html` | מדרגות מס, נקודות זיכוי, מענקים |
| `login.html` | התחברות Google דרך Firebase Auth |
| `terms.html` | תנאי שימוש |

## טכנולוגיות

- Vanilla JS + Tailwind (CDN) + Chart.js + D3
- Firebase (Auth + Firestore) — קונפיגורציה ב-`firebase-config.js`
- PWA (`sw.js`, `manifest.json`)
- Cloudflare Worker פרוקסי CORS (`worker/`) לשליפת מחירי מניות
- GitHub Actions (`.github/workflows/`) — שליפת מחירים יומית

## הרצה מקומית

```bash
npm install
npm run dev
```

יפתח את `login.html` בפורט 5500. במצב localhost, כתיבות ל-Firestore חסומות כברירת מחדל כדי לא לדרוס את ה-production. לאישור ידני בקונסול:

```js
window.ftLocalDev.allowCloudWrites()
```

## Deploy

האתר עצמו: GitHub Pages משרת את הריפו כמו שהוא — push ל-`main` ומספיק.

ה-Cloudflare Worker (פרוקסי המחירים): ראה `DEPLOY-INSTRUCTIONS.md`.

## מבנה תיקיות

```
.
├── *.html              # מודולי האפליקציה (קבצי-ענק עם JS inline — בתהליך פירוק)
├── ai-assistant.js     # עוזר AI מבוסס Claude
├── firebase-config.js  # אתחול Firebase + הגנת localhost
├── shared/             # קוד משותף בין דפים (theme, nav, charts, sync-bus)
├── shared-theme.css    # ערכת נושא Bloomberg Dark
├── worker/             # Cloudflare Worker — פרוקסי CORS למחירי מניות
├── scripts/            # סקריפט Node לשליפת מחירים יומית
└── icons/              # אייקוני PWA
```

## תוכניות שדרוג

ראה `UI-AI-UPGRADE-PLAN.md` — תוכנית פירוט לעוזר AI, command palette, ושאר שיפורי UX.
