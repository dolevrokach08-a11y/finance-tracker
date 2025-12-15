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

// שליפת מחיר לנייר ישראלי מ-TheMarker
async function fetchTheMarkerPrice(securityNumber) {
  try {
    const markerUrl = `https://finance.themarker.com/etf/${securityNumber}`;
    
    const response = await fetch(markerUrl, {
      method: 'GET',
      headers: {
        'Accept': 'text/html',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (response.ok) {
      const html = await response.text();
      
      const patterns = [
        /שער אחרון[^\d]*\|\s*([0-9,]+\.?[0-9]*)/,
        /שער אחרון[^|]*\|\s*([0-9,]+\.?[0-9]*)/,
        /(?:שער אחרון|מחיר נוכחי|שווי יחידה)[\s\S]{0,50}?([0-9,]+\.?[0-9]*)/,
        /(?:מחיר|שער)[\s:|\-]{1,10}([0-9,]+\.?[0-9]*)/
      ];
      
      for (let i = 0; i < patterns.length; i++) {
        const match = html.match(patterns[i]);
        if (match && match[1]) {
          let priceStr = match[1].trim();
          let price = parseFloat(priceStr.replace(/,/g, ''));
          
          if (price && price > 0) {
            // Convert from agorot if > 100
            if (price > 100) {
              price = price / 100;
            }
            return {
              price: price,
              currency: 'ILS',
              name: `Israeli Security ${securityNumber}`
            };
          }
        }
      }
    }
  } catch (error) {
    console.log(`   ⚠️ TheMarker failed for ${securityNumber}: ${error.message}`);
  }
  return null;
}

// שליפת מחיר לנייר ישראלי מ-Globes
async function fetchGlobesPrice(securityNumber) {
  try {
    const globesUrl = `https://www.globes.co.il/portal/instrument.aspx?instrumentid=${securityNumber}`;
    
    const response = await fetch(globesUrl, {
      method: 'GET',
      headers: {
        'Accept': 'text/html',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (response.ok) {
      const html = await response.text();
      
      const patterns = [
        /(?:שער|מחיר|שווי)[^\d]{0,30}(\d{1,3}(?:,\d{3})*(?:\.\d+)?)/,
        /class="[^"]*price[^"]*"[^>]*>(\d{1,3}(?:,\d{3})*(?:\.\d+)?)/
      ];
      
      for (let i = 0; i < patterns.length; i++) {
        const match = html.match(patterns[i]);
        if (match && match[1]) {
          let priceStr = match[1].trim();
          let price = parseFloat(priceStr.replace(/,/g, ''));
          
          if (price && price > 0 && price < 10000) {
            // Convert from agorot if > 100
            if (price > 100) {
              price = price / 100;
            }
            return {
              price: price,
              currency: 'ILS',
              name: `Israeli Security ${securityNumber}`
            };
          }
        }
      }
    }
  } catch (error) {
    console.log(`   ⚠️ Globes failed for ${securityNumber}: ${error.message}`);
  }
  return null;
}

// שליפת מחיר לנייר ישראלי - עם כל ה-fallbacks
async function fetchIsraeliPrice(securityNumber) {
  console.log(`   🇮🇱 Trying Israeli sources for ${securityNumber}...`);
  
  // Try TheMarker first
  let result = await fetchTheMarkerPrice(securityNumber);
  if (result) {
    console.log(`   ✅ TheMarker: ${result.price}`);
    return result;
  }
  
  // Try Globes
  result = await fetchGlobesPrice(securityNumber);
  if (result) {
    console.log(`   ✅ Globes: ${result.price}`);
    return result;
  }
  
  return null;
}

// זיהוי סוג הנייר ושליפת מחיר
async function fetchPrice(symbol, currency) {
  // אם זה מספר (נייר ישראלי)
  if (/^\d+$/.test(symbol)) {
    return await fetchIsraeliPrice(symbol);
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
