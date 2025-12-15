/**
 * Daily Price Fetcher
 * שולף מחירים יומיים ושומר ב-Firebase
 */

const admin = require('firebase-admin');
const yahooFinance = require('yahoo-finance2').default;

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
    console.log(`   ⚠️ Yahoo failed for ${symbol}: ${error.message}`);
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
    console.log(`   ⚠️ TASE failed for ${securityNumber}: ${error.message}`);
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

// פונקציה ראשית
async function main() {
  console.log('🚀 Starting daily price fetch...');
  console.log(`📅 Date: ${getTodayDate()}`);
  
  const todayDate = getTodayDate();
  const prices = {};
  const allSymbols = new Set();
  
  try {
    // גישה ישירה לכל ה-portfolio/data documents
    console.log('📂 Looking for user portfolios...');
    
    const usersRef = db.collection('users');
    const usersListSnap = await usersRef.listDocuments();
    
    console.log(`   Found ${usersListSnap.length} user references`);
    
    for (const userDocRef of usersListSnap) {
      const portfolioDataRef = userDocRef.collection('portfolio').doc('data');
      const portfolioSnap = await portfolioDataRef.get();
      
      if (portfolioSnap.exists) {
        const data = portfolioSnap.data();
        console.log(`   ✅ Found data for user ${userDocRef.id}`);
        
        // איסוף סימבולים מהחזקות
        if (data.holdings && Array.isArray(data.holdings)) {
          console.log(`      Holdings: ${data.holdings.length}`);
          data.holdings.forEach(h => {
            if (h.symbol) allSymbols.add(h.symbol);
          });
        }
        
        // איסוף סימבולים מאג"ח
        if (data.bonds && Array.isArray(data.bonds)) {
          console.log(`      Bonds: ${data.bonds.length}`);
          data.bonds.forEach(b => {
            if (b.symbol) allSymbols.add(b.symbol);
            if (b.securityNumber) allSymbols.add(b.securityNumber);
          });
        }
      }
    }
    
    console.log(`\n📊 Found ${allSymbols.size} unique symbols:`);
    allSymbols.forEach(s => console.log(`   - ${s}`));
    
    // שליפת מחירים לכל הסימבולים
    console.log('\n💰 Fetching prices...');
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
        fetchedSymbols: Object.keys(prices).length,
        totalSymbols: allSymbols.size,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      console.log(`\n✅ Saved ${Object.keys(prices).length} prices for ${todayDate}`);
    } else {
      console.log('\n⚠️ No prices fetched');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
  
  console.log('\n🎉 Done!');
  process.exit(0);
}

main();
