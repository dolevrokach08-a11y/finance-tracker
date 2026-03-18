# Finance Tracker - הוראות Deploy

## מה צריך לעשות

### שלב 1: Deploy של Cloudflare Worker (פרוקסי CORS)

העובד כבר מוכן בתיקיית `worker/`. צריך רק לעשות deploy.

```bash
cd worker
npx wrangler deploy
```

- אם אין חשבון Cloudflare - תתבקש להתחבר בדפדפן
- אחרי ה-deploy תקבל URL כזה: `https://finance-proxy.YOUR_SUBDOMAIN.workers.dev`
- **שמור את ה-URL הזה!**

### שלב 2: עדכון ה-URL בקוד

בקובץ `portfolio.html` בשורה 2815, עדכן את `CF_WORKER_URL`:

```javascript
// שנה מ:
const CF_WORKER_URL = '';

// ל:
const CF_WORKER_URL = 'https://finance-proxy.YOUR_SUBDOMAIN.workers.dev/?url=';
```

**חשוב:** ה-URL חייב להסתיים ב-`/?url=`

### שלב 3: Commit ו-Push

```bash
git add portfolio.html
git commit -m "Update CF_WORKER_URL with deployed worker URL"
git push
```

---

## למה זה חשוב?

- בלי ה-Worker, רענון מחירים משתמש בפרוקסי CORS חינמיים (איטיים ולא אמינים)
- עם ה-Worker: batch של 4 מניות במקביל, השהיה של 300ms בין קבוצות
- בלי ה-Worker: batch של 2, השהיה של 1000ms
- ה-Worker גם מאפשר שליפת מדדים במקביל (פי 4 יותר מהיר)
- Free tier של Cloudflare: 100,000 בקשות ביום

---

## GitHub Actions - שליפת מחירים יומית

כדי שהמחירים יתעדכנו אוטומטית כל יום:

1. לך ל-Settings > Secrets and variables > Actions בריפו שלך ב-GitHub
2. הוסף secret בשם `FIREBASE_SERVICE_ACCOUNT` עם ה-JSON של service account מ-Firebase Console:
   - Firebase Console > Project Settings > Service Accounts > Generate New Private Key
3. ה-workflow ירוץ אוטומטית:
   - ימי חול ב-14:00 UTC (שעות מסחר בארה"ב)
   - כל יום ב-21:00 UTC (אחרי סגירת השוק)

---

## מבנה הפרויקט (לידיעה)

```
finance-tracker/
├── worker/
│   ├── worker.js          # Cloudflare Worker - פרוקסי CORS ל-Yahoo Finance
│   └── wrangler.toml      # הגדרות Wrangler
├── scripts/
│   ├── fetch-prices.js    # סקריפט שליפת מחירים יומי (GitHub Actions)
│   └── package.json
├── .github/workflows/
│   └── daily-prices.yml   # GitHub Actions workflow
├── index.html             # דף ראשי / דשבורד
├── login.html             # דף התחברות
├── finance.html           # מעקב הכנסות/הוצאות
├── portfolio.html         # תיק השקעות (הקובץ הגדול - כל הלוגיקה)
├── tax-optimizer.html     # אופטימיזציית מס
├── firebase-config.js     # הגדרות Firebase
├── demo-data.js           # נתוני דמו
├── sw.js                  # Service Worker (PWA)
└── manifest.json          # PWA manifest
```
