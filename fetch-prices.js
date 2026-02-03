/**
 * Daily Price Fetcher
 * שולף מחירים יומיים ושומר ב-Firebase
 */

import admin from 'firebase-admin';
import yahooFinance from 'yahoo-finance2';

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

// שליפת מחיר מ-Yahoo Finance
async function fetchYahooPrice(symbol) {
  try {
    const quote = await yahooFinance.quote(symbol);
    if (quote && quote.regularMarketPrice) {
      return {
        price: quote.regularMarketPrice,
        currency: quote.currency || 'USD',
        name: quote.shortName || quote.longName || symbol
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

// שליפת היסטוריית מחירים של אינדקס
async function fetchIndexHistory(symbol, days = 365) {
  try {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const result = await yahooFinance.chart(symbol, {
      period1: startDate,
      period2: endDate,
      interval: '1d'
    });
    
    if (result && result.quotes && result.quotes.length > 0) {
      // המרה למבנה פשוט: { date: price }
      const history = {};
      for (const quote of result.quotes) {
        if (quote.close && quote.date) {
          const dateStr = quote.date.toISOString().split('T')[0];
          history[dateStr] = quote.close;
        }
      }
      return history;
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
    // קריאת כל המשתמשים
    const usersSnapshot = await db.collection('users').get();
    
    const allSymbols = new Set();
    
    for (const userDoc of usersSnapshot.docs) {
      const portfolioRef = db.collection('users').doc(userDoc.id).collection('portfolio').doc('data');
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
    
    // שליפת מחירים לכל הסימבולים
    for (const symbol of allSymbols) {
      console.log(`   Fetching ${symbol}...`);
      const result = await fetchPrice(symbol);
      
      if (result) {
        prices[symbol] = {
          price: result.price,
          currency: result.currency,
          name: result.name,
          fetchedAt: new Date().toISOString()
        };
        console.log(`   ✅ ${symbol}: ${result.price} ${result.currency}`);
      } else {
        console.log(`   ❌ ${symbol}: Failed to fetch`);
      }
      
      // המתנה קצרה בין בקשות
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // שמירה ב-Firebase
    if (Object.keys(prices).length > 0) {
      await db.collection('dailyPrices').doc(todayDate).set({
        date: todayDate,
        prices: prices,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      console.log(`\n✅ Saved ${Object.keys(prices).length} prices for ${todayDate}`);
    } else {
      console.log('\n⚠️ No prices fetched');
    }
    
    // === שליפת היסטוריית אינדקסים ===
    console.log('\n📈 Fetching index history...');
    
    const indices = [
      { symbol: 'ACWI', name: 'MSCI ACWI' },
      { symbol: 'SPY', name: 'S&P 500' },
      { symbol: 'QQQ', name: 'NASDAQ' },
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
