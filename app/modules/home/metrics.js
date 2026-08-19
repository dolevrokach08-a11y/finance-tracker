function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function sum(items, selector) {
    return Array.isArray(items) ? items.reduce((total, item) => total + number(selector(item)), 0) : 0;
}

function rateFor(currency, rates) {
    if (currency === 'USD') return number(rates?.USD) || 3.7;
    if (currency === 'EUR') return number(rates?.EUR) || 4.1;
    return 1;
}

function portfolioMetrics(portfolio, cachedTwr) {
    if (!portfolio) return { total: 0, invested: 0, cash: 0, cost: 0, pensions: 0, returnPct: null, history: [], allocation: [] };
    const rates = portfolio.rates || {};
    let stocks = 0;
    let bonds = 0;
    let cost = 0;

    (portfolio.holdings || []).forEach(holding => {
        const rate = rateFor(holding.currency, rates);
        const units = number(holding.shares);
        stocks += units * number(holding.currentPrice) * rate;
        cost += units * number(holding.costBasis) * rate;
    });
    (portfolio.bonds || []).forEach(bond => {
        const rate = rateFor(bond.currency, rates);
        const units = number(bond.units);
        bonds += units * number(bond.currentPrice) * rate;
        cost += units * number(bond.costBasis) * rate;
    });

    const cash = number(portfolio.cash?.ILS)
        + number(portfolio.cash?.USD) * rateFor('USD', rates)
        + number(portfolio.cash?.EUR) * rateFor('EUR', rates);
    const invested = stocks + bonds;
    // Tradeable portfolio only. Pensions and study funds are excluded here on
    // purpose — the rest of the app keeps them out of performance figures — but
    // they are real money and must land in net worth below.
    const total = invested + cash;
    const pensions = sum(portfolio.pensions, item => item.currentValue);

    // Real TWR, from the snapshots this module already holds. It used to show a
    // cost-basis return under the same label whenever portfolio_cachedTWR was
    // missing or over a day old — a different measure, silently substituted. The
    // cache is now only a shortcut: identical answer, one less pass.
    const twrEngine = typeof globalThis !== 'undefined' ? globalThis.FTPortfolioTWR : null;
    let returnPct = null;
    if (cachedTwr && typeof cachedTwr.total === 'number' && Date.now() - number(cachedTwr.timestamp) < 86_400_000) {
        returnPct = cachedTwr.total;
    } else if (twrEngine) {
        const twr = twrEngine.calculate(portfolio.snapshots, invested + cash);
        returnPct = twr ? twr.total : null;
    }

    const snapshots = Array.isArray(portfolio.snapshots) ? portfolio.snapshots : [];
    const history = snapshots
        .filter(item => item?.date)
        .sort((a, b) => new Date(a.date) - new Date(b.date))
        .map(item => number(item.totalValue ?? item.value ?? (number(item.value_before_flow) + number(item.cash_flow))))
        .filter(value => value > 0)
        .slice(-60);

    const allocation = [
        { id: 'stocks', label: 'מניות וקרנות', value: stocks, color: '#c9ff47' },
        { id: 'bonds', label: 'אג״ח', value: bonds, color: '#6c8cff' },
        { id: 'cash', label: 'מזומן', value: cash, color: '#ad85ff' },
    ].filter(item => item.value > 0);

    return { total, invested, cash, cost, pensions, returnPct, history, allocation };
}

function financeMetrics(finance, cachedSummary) {
    const empty = { income: 0, expenses: 0, freeCash: 0, assets: 0, liabilities: 0, assetsByCategory: {}, netWorth: 0, month: null, hasCashflow: false };
    if (!finance) return empty;

    const assets = sum(finance.netWorthAssets, item => item.value);
    const liabilities = sum(finance.netWorthLiabilities, item => item.value);
    // Kept per category so net worth can tell a hand-typed portfolio or pension
    // figure apart from a house or a car, and prefer the live value for the
    // former without dropping the latter.
    const assetsByCategory = {};
    (Array.isArray(finance.netWorthAssets) ? finance.netWorthAssets : []).forEach(item => {
        const key = String(item?.category || 'other').toLowerCase();
        assetsByCategory[key] = (assetsByCategory[key] || 0) + number(item?.value);
    });

    // Same rules finance.html applies, from the same file, so the two screens
    // agree on the first load rather than only after the finance page has been
    // visited once.
    const rules = typeof globalThis !== 'undefined' ? globalThis.FTFinance : null;
    if (rules) {
        const month = cachedSummary?.month || rules.currentMonthKey();
        const summary = rules.monthSummary(finance, month);
        return {
            income: summary.inc,
            expenses: summary.exp,
            freeCash: summary.available,
            month,
            hasCashflow: summary.hasData,
            assets, liabilities, assetsByCategory, netWorth: assets - liabilities,
        };
    }

    // Only if the shared rules failed to load: fixed templates alone. Coarse —
    // it ignores transactions — so hasCashflow reflects whether it found anything.
    const income = sum(finance.fixedIncomes, item => item.amount);
    const expenses = sum(finance.fixedExpenses, item => item.amount);
    return { income, expenses, freeCash: income - expenses, month: null, hasCashflow: Boolean(income || expenses), assets, liabilities, assetsByCategory, netWorth: assets - liabilities };
}

// Standard annuity payment — mirrors pmt() in mortgage.html so the home card
// and the mortgage page cannot disagree about the same tranche.
function tranchePayment(tranche) {
    const principal = number(tranche.principal ?? tranche.balance ?? tranche.amount);
    const months = number(tranche.months);
    if (!(principal > 0) || !(months > 0)) return 0;
    const monthlyRate = number(tranche.rate) / 12 / 100;
    if (!(monthlyRate > 0)) return principal / months;
    const growth = Math.pow(1 + monthlyRate, months);
    return principal * monthlyRate * growth / (growth - 1);
}

function mortgageMetrics(mortgage) {
    if (!mortgage) return { balance: 0, monthlyPayment: 0 };

    // Two different shapes arrive here. mortgage.html publishes a flat summary
    // under localStorage 'mortgageData' (remainingBalance / loanAmount /
    // monthlyPayment), while 'mortgageState' and the demo generator carry the
    // tranche list instead. Reading only routes/tracks — which neither shape
    // has — is why this card reported a zero balance for every account.
    const tranches = Array.isArray(mortgage.tranches) ? mortgage.tranches
        : Array.isArray(mortgage.routes) ? mortgage.routes
        : Array.isArray(mortgage.tracks) ? mortgage.tracks
        : [];

    const balance = number(mortgage.remainingBalance ?? mortgage.loanAmount)
        || sum(tranches, item => item.balance ?? item.principal ?? item.amount);

    const monthlyPayment = number(mortgage.monthlyPayment ?? mortgage.summary?.monthlyPayment)
        || sum(tranches, tranchePayment);

    return { balance, monthlyPayment };
}

function recentActivity(portfolio) {
    if (!portfolio) return [];
    const rates = portfolio.rates || {};
    const toIls = item => number(item.amount) * rateFor(item.currency || 'ILS', rates);
    return [
        ...(portfolio.purchases || []).map(item => ({ type: 'buy', date: item.date, label: `קנייה · ${item.symbol || 'נייר ערך'}`, amount: -toIls(item) })),
        ...(portfolio.sales || []).map(item => ({ type: 'sell', date: item.date, label: `מכירה · ${item.symbol || 'נייר ערך'}`, amount: toIls(item) })),
        ...(portfolio.deposits || []).map(item => ({ type: 'deposit', date: item.date, label: 'הפקדה לתיק', amount: toIls(item) })),
        ...(portfolio.withdrawals || []).map(item => ({ type: 'withdraw', date: item.date, label: 'משיכה מהתיק', amount: -toIls(item) })),
    ]
        .filter(item => item.date && Number.isFinite(item.amount))
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 5);
}

function buildInsight({ finance, portfolio, mortgage }) {
    if (!finance.income && !portfolio.total) {
        return {
            tone: 'neutral',
            eyebrow: 'הצעד הראשון',
            title: 'בנה תמונה פיננסית אמיתית',
            body: 'הוסף תיק השקעות או חודש ראשון של הכנסות והוצאות — מכאן המערכת תחבר את כל המדדים עבורך.',
            route: 'portfolio',
            action: 'להתחלת התיק',
        };
    }
    if (finance.freeCash < 0) {
        return {
            tone: 'warning',
            eyebrow: 'דורש תשומת לב',
            title: 'ההוצאות הקבועות גבוהות מההכנסה',
            body: 'כדאי לפתוח את מסך התזרים ולזהות אילו התחייבויות אפשר לצמצם לפני החלטת השקעה נוספת.',
            route: 'finance',
            action: 'לניתוח התזרים',
        };
    }
    if (finance.income && mortgage.monthlyPayment / finance.income > .35) {
        return {
            tone: 'warning',
            eyebrow: 'יחס החזר',
            title: 'המשכנתא תופסת חלק משמעותי מההכנסה',
            body: 'הרץ מבחן לחץ על התמהיל ובדוק איך שינוי ריבית משפיע על מרווח הביטחון החודשי.',
            route: 'mortgage',
            action: 'לבדיקת תרחיש',
        };
    }
    if (portfolio.total && portfolio.cash / portfolio.total > .2) {
        return {
            tone: 'opportunity',
            eyebrow: 'הזדמנות',
            title: 'חלק גדול מהתיק נמצא במזומן',
            body: 'ייתכן שזה מכוון. אם לא, בדוק את ההקצאה מול יעדי התיק וראה היכן נוצר הפער.',
            route: 'portfolio',
            action: 'לבדיקת ההקצאה',
        };
    }
    return {
        tone: 'positive',
        eyebrow: 'התמונה יציבה',
        title: 'יש לך מרווח חיובי להחלטה הבאה',
        body: 'התזרים הקבוע חיובי. עכשיו אפשר לבחון אם להפנות את העודף ליעד, לחוב או להגדלת ההשקעה.',
        route: 'finance',
        action: 'לתכנון העודף',
    };
}

export function deriveMetrics(data = {}) {
    const portfolio = portfolioMetrics(data.portfolio, data.cachedTwr);
    const finance = financeMetrics(data.finance, data.cachedFinance);
    const mortgage = mortgageMetrics(data.mortgage);
    // Count everything once. The finance page lets you type a portfolio or a
    // pension in by hand, and those entries go stale the moment the real figure
    // moves — so where the app tracks the live value, it replaces the typed one
    // instead of being added on top of it. A house or a car has no live source
    // and stays exactly as entered.
    const manual = finance.assetsByCategory || {};
    const livePortfolio = portfolio.total > 0;
    const livePensions = portfolio.pensions > 0;
    const supersededByLive = (livePortfolio ? number(manual.investments) : 0)
        + (livePensions ? number(manual.pension) : 0);
    const combinedNetWorth = finance.assets - supersededByLive - finance.liabilities
        + portfolio.total + portfolio.pensions;
    const debtRatio = finance.income > 0 ? (mortgage.monthlyPayment / finance.income) * 100 : null;
    const hasData = Boolean(data.finance || data.portfolio || data.mortgage);

    const result = {
        hasData,
        portfolio,
        finance,
        mortgage,
        combinedNetWorth,
        debtRatio,
        recent: recentActivity(data.portfolio),
    };
    result.insight = buildInsight(result);
    return result;
}
