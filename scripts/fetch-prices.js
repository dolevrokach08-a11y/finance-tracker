/**
 * Daily Price Fetcher
 * שולף מחירים יומיים ושומר ב-Firebase
 */

import admin from 'firebase-admin';

// Yahoo requests are proxied through the Cloudflare Worker: Yahoo rate-limits
// GitHub runner IPs (429), and yahoo-finance2 v2.14+/v3 broke the API anyway.
const YAHOO_PROXY = 'https://finance-proxy.dolevrokach08.workers.dev/?url=';

async function fetchYahooJson(yahooUrl) {
  const response = await fetch(YAHOO_PROXY + encodeURIComponent(yahooUrl));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json();
}

// Initialize Firebase Admin
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// תאריך היום בפורמט YYYY-MM-DD
function getTodayDate() {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

// שליפת מחיר מ-Yahoo Finance (דרך ה-Worker; chart meta במקום quote — לא דורש crumb)
async function fetchYahooPrice(symbol) {
  try {
    const data = await fetchYahooJson(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`
    );
    const meta = data?.chart?.result?.[0]?.meta;
    if (meta && meta.regularMarketPrice) {
      return {
        price: meta.regularMarketPrice,
        currency: meta.currency || 'USD',
        name: meta.shortName || meta.longName || symbol
      };
    }
  } catch (error) {
    console.log(`⚠️ Yahoo failed for ${symbol}: ${error.message}`);
  }
  return null;
}

// שליפת מחיר לנייר ישראלי מ-TASE
async function fetchTASEPrice(securityNumber) {
  try {
    const response = await fetch(
      `https://api.tase.co.il/api/security/${securityNumber}/data`,
      {
        headers: {
          'Accept': 'application/json',
          'Accept-Language': 'he-IL'
        }
      }
    );
    if (response.ok) {
      const data = await response.json();
      if (data && data.LastRate) {
        return {
          price: data.LastRate,
          currency: 'ILS',
          name: data.SecurityName || securityNumber
        };
      }
    }
  } catch (error) {
    console.log(`⚠️ TASE failed for ${securityNumber}: ${error.message}`);
  }
  return null;
}

// זיהוי סוג הנייר ושליפת מחיר
async function fetchPrice(symbol, currency) {
  // אם זה מספר (נייר ישראלי)
  if (/^\d+$/.test(symbol)) {
    return await fetchTASEPrice(symbol);
  }

  // אם יש סיומת של בורסה
  if (symbol.includes('.')) {
    return await fetchYahooPrice(symbol);
  }

  // ניסיון עם Yahoo (מניות אמריקאיות)
  let result = await fetchYahooPrice(symbol);
  if (result) return result;

  // ניסיון עם סיומות שונות
  const suffixes = ['.L', '.DE', '.TA'];
  for (const suffix of suffixes) {
    result = await fetchYahooPrice(symbol + suffix);
    if (result) return result;
  }

  return null;
}

// שליפת מחיר עם retry
async function fetchPriceWithRetry(symbol, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const result = await fetchPrice(symbol);
    if (result) return result;
    if (attempt < retries) {
      console.log(`   🔄 Retry ${attempt + 1}/${retries} for ${symbol}...`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  return null;
}

// שליפת היסטוריית מחירים של אינדקס.
// 5 שנים — חייב לכסות את ה-snapshot הראשון בתיק, אחרת חישובי ה-TWR/MWR
// באתר ימפו בשקט תאריכים ישנים למחיר הזמין הראשון והתקופה תתאפס.
async function fetchIndexHistory(symbol, days = 1825) {
  try {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const period1 = Math.floor(startDate.getTime() / 1000);
    const period2 = Math.floor(endDate.getTime() / 1000);
    const data = await fetchYahooJson(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d`
    );

    const result = data?.chart?.result?.[0];
    const timestamps = result?.timestamp;
    const closes = result?.indicators?.quote?.[0]?.close;

    if (timestamps && closes && timestamps.length > 0) {
      // המרה למבנה פשוט: { date: price }
      const history = {};
      for (let i = 0; i < timestamps.length; i++) {
        if (closes[i] != null) {
          const dateStr = new Date(timestamps[i] * 1000).toISOString().split('T')[0];
          history[dateStr] = closes[i];
        }
      }
      if (Object.keys(history).length > 0) return history;
    }
  } catch (error) {
    console.log(`⚠️ Failed to fetch history for ${symbol}: ${error.message}`);
  }
  return null;
}

// פונקציה ראשית
async function main() {
  console.log('🚀 Starting daily price fetch...');
  console.log(`📅 Date: ${getTodayDate()}`);
  
  const todayDate = getTodayDate();
  const prices = {};
  
  try {
    // קריאת כל המשתמשים. listDocuments ולא get() — מסמכי users הם "נתיבי
    // פנטום" (קיימת רק תת-collection), ו-get() מחזיר עבורם רשימה ריקה.
    const userRefs = await db.collection('users').listDocuments();

    const allSymbols = new Set();

    for (const userRef of userRefs) {
      const portfolioRef = userRef.collection('portfolio').doc('data');
      const portfolioSnap = await portfolioRef.get();
      
      if (portfolioSnap.exists) {
        const data = portfolioSnap.data();
        
        // איסוף סימבולים מהחזקות
        if (data.holdings && Array.isArray(data.holdings)) {
          data.holdings.forEach(h => {
            if (h.symbol) allSymbols.add(h.symbol);
          });
        }
        
        // איסוף סימבולים מאג"ח
        if (data.bonds && Array.isArray(data.bonds)) {
          data.bonds.forEach(b => {
            if (b.symbol) allSymbols.add(b.symbol);
            if (b.securityNumber) allSymbols.add(b.securityNumber);
          });
        }
      }
    }
    
    console.log(`📊 Found ${allSymbols.size} unique symbols`);
    
    // שליפת מחירים לכל הסימבולים (עם retry)
    let failCount = 0;
    for (const symbol of allSymbols) {
      console.log(`   Fetching ${symbol}...`);
      const result = await fetchPriceWithRetry(symbol);

      if (result) {
        prices[symbol] = {
          price: result.price,
          currency: result.currency,
          name: result.name,
          fetchedAt: new Date().toISOString()
        };
        console.log(`   ✅ ${symbol}: ${result.price} ${result.currency}`);
      } else {
        failCount++;
        console.log(`   ❌ ${symbol}: Failed to fetch`);
      }

      // המתנה קצרה בין בקשות
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // שמירה ב-Firebase
    if (Object.keys(prices).length > 0) {
      // שמירה לפי תאריך
      await db.collection('dailyPrices').doc(todayDate).set({
        date: todayDate,
        prices: prices,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // שמירת alias "latest" - כדי שהקליינט יוכל לקרוא בקלות
      await db.collection('dailyPrices').doc('latest').set({
        date: todayDate,
        prices: prices,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      const successCount = Object.keys(prices).length;
      console.log(`\n✅ Saved ${successCount} prices for ${todayDate}`);
      console.log(`📊 Success rate: ${successCount}/${allSymbols.size} (${((successCount / allSymbols.size) * 100).toFixed(0)}%)`);

      // כשל אם יותר מחצי נכשלו
      if (failCount > allSymbols.size / 2) {
        console.error('⚠️ More than 50% of symbols failed - marking as warning');
      }
    } else {
      console.log('\n⚠️ No prices fetched');
    }
    
    // === שליפת היסטוריית אינדקסים ===
    console.log('\n📈 Fetching index history...');
    
    // Irish UCITS accumulating ETFs (LSE, USD) — price includes reinvested
    // dividends, unlike the distributing US versions (SPY/QQQ/ACWI).
    const indices = [
      { symbol: 'ISAC.L', name: 'MSCI ACWI (Acc)' },
      { symbol: 'CSPX.L', name: 'S&P 500 (Acc)' },
      { symbol: 'CNDX.L', name: 'NASDAQ 100 (Acc)' },
      { symbol: '^TA125.TA', name: 'ת"א 125' }
    ];
    
    const indexHistory = {};
    
    for (const index of indices) {
      console.log(`   Fetching ${index.name} (${index.symbol})...`);
      const history = await fetchIndexHistory(index.symbol);
      
      if (history && Object.keys(history).length > 0) {
        indexHistory[index.symbol] = {
          name: index.name,
          history: history
        };
        console.log(`   ✅ ${index.name}: ${Object.keys(history).length} days`);
      } else {
        console.log(`   ❌ ${index.name}: Failed to fetch`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // שמירת היסטוריית אינדקסים
    if (Object.keys(indexHistory).length > 0) {
      await db.collection('indexHistory').doc('latest').set({
        indices: indexHistory,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      console.log(`\n✅ Saved index history for ${Object.keys(indexHistory).length} indices`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
  
  console.log('\n🎉 Done!');
  process.exit(0);
}

main();
