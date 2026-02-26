// Demo Data Module - Fictitious financial data for demonstration purposes
// All names, amounts, and details are completely fictional

const DEMO_USER = {
    displayName: 'משתמש לדוגמה',
    email: 'demo@example.com',
    photoURL: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%2300f5d4"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>',
    uid: 'demo-user-readonly'
};

function generateDemoFinanceData() {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    const transactions = [];
    let idCounter = 1000;

    // Generate 6 months of data
    for (let monthOffset = 0; monthOffset < 6; monthOffset++) {
        let m = currentMonth - monthOffset;
        let y = currentYear;
        if (m <= 0) { m += 12; y--; }
        const monthKey = `${y}-${String(m).padStart(2, '0')}`;

        // Income transactions
        transactions.push({
            id: idCounter++,
            type: 'income',
            desc: 'משכורת - חברת טכנולוגיה',
            amt: 18500,
            cat: 'משכורת',
            month: monthKey,
            earner: 'father'
        });

        transactions.push({
            id: idCounter++,
            type: 'income',
            desc: 'פרילנס - פיתוח אתר',
            amt: 3200 + Math.floor(Math.random() * 2000),
            cat: 'פרילנס',
            month: monthKey,
            earner: 'father'
        });

        transactions.push({
            id: idCounter++,
            type: 'income',
            desc: 'משכורת - הוראה',
            amt: 8200,
            cat: 'משכורת',
            month: monthKey,
            earner: 'mother'
        });

        // Expense transactions
        const expenses = [
            { desc: 'סופר ירוק - קניות שבועיות', amt: 850, cat: 'מזון' },
            { desc: 'שוק מחנה יהודה', amt: 320, cat: 'מזון' },
            { desc: 'מסעדת הדגים', amt: 280, cat: 'מזון' },
            { desc: 'רשת פארם', amt: 190, cat: 'בריאות' },
            { desc: 'רכב - דלק', amt: 650, cat: 'תחבורה' },
            { desc: 'רכב - ביטוח חודשי', amt: 380, cat: 'תחבורה' },
            { desc: 'חשמל', amt: 420 + Math.floor(Math.random() * 200), cat: 'חשבונות' },
            { desc: 'מים', amt: 180, cat: 'חשבונות' },
            { desc: 'אינטרנט + טלוויזיה', amt: 250, cat: 'חשבונות' },
            { desc: 'סלולרי', amt: 90, cat: 'חשבונות' },
            { desc: 'קניון - ביגוד', amt: 350 + Math.floor(Math.random() * 300), cat: 'קניות' },
            { desc: 'סינמה סיטי', amt: 120, cat: 'בילויים' },
            { desc: 'שיעור פילאטיס', amt: 350, cat: 'בריאות' },
            { desc: 'גן ילדים', amt: 2800, cat: 'חינוך' },
            { desc: 'חוגים', amt: 450, cat: 'חינוך' },
        ];

        expenses.forEach(exp => {
            transactions.push({
                id: idCounter++,
                type: 'expense',
                desc: exp.desc,
                amt: exp.amt,
                cat: exp.cat,
                month: monthKey
            });
        });
    }

    // Fixed incomes
    const fixedIncomes = [
        {
            id: 2001,
            desc: 'דמי שכירות דירה להשקעה',
            amount: 4200,
            start: `${currentYear}-01`,
            end: `${currentYear}-12`,
            earner: 'father'
        }
    ];

    // Fixed expenses
    const fixedExpenses = [
        {
            id: 3001,
            desc: 'משכנתא',
            amount: 4800,
            start: `${currentYear - 2}-01`,
            end: `${currentYear + 18}-12`
        },
        {
            id: 3002,
            desc: 'ועד בית',
            amount: 320,
            start: `${currentYear}-01`,
            end: `${currentYear}-12`
        },
        {
            id: 3003,
            desc: 'ביטוח דירה',
            amount: 180,
            start: `${currentYear}-01`,
            end: `${currentYear}-12`
        }
    ];

    // Donations (tithes)
    const donations = [];
    for (let monthOffset = 0; monthOffset < 4; monthOffset++) {
        let m = currentMonth - monthOffset;
        let y = currentYear;
        if (m <= 0) { m += 12; y--; }
        const monthKey = `${y}-${String(m).padStart(2, '0')}`;
        donations.push({
            id: 4000 + monthOffset,
            amount: 1500 + Math.floor(Math.random() * 500),
            to: 'עמותת חסד',
            date: new Date(y, m - 1, 15).toLocaleDateString('he-IL'),
            time: new Date(y, m - 1, 15).toISOString()
        });
    }

    return {
        transactions,
        fixedIncomes,
        fixedExpenses,
        donations,
        payslips: [],
        incomeCategories: ['משכורת', 'פרילנס', 'השקעות', 'מתנות', 'דמי שכירות', 'אחר'],
        expenseCategories: ['מזון', 'תחבורה', 'קניות', 'בילויים', 'חשבונות', 'בריאות', 'חינוך', 'דיור', 'אחר'],
        categoryRules: [],
        budgets: {
            'מזון': 2000,
            'תחבורה': 1200,
            'בילויים': 800,
            'חשבונות': 1200,
            'קניות': 1000,
            'בריאות': 800,
            'חינוך': 3500,
            'דיור': 5500
        }
    };
}

function generateDemoPortfolioData() {
    const now = new Date();
    const currentYear = now.getFullYear();
    const usdRate = 3.65;

    // ===== Timeline =====
    // Y-1 March:  Deposit 50,000  → Buy VT + bond 5131784
    // Y-1 June:   Deposit 35,000  → Buy CSPX
    // Y-1 Sep:    Deposit 25,000  → Buy 1159235 (TASE bond-like ETF)
    // Y   Jan:    Deposit 15,000  → Buy AVDV + bond 5122510
    // Y   Feb:    Deposit 10,000  → Buy AVES

    const baseId = 1700000000000; // stable IDs for demo

    const holdings = [
        {
            id: baseId + 1,
            symbol: 'VT',
            name: 'Vanguard Total World Stock ETF',
            shares: 30,
            costBasis: 98.50,
            currentPrice: 108.20,
            currency: 'USD',
            groupId: 1,
            purchaseDate: new Date(`${currentYear - 1}-03-15T12:00:00.000Z`).toISOString()
        },
        {
            id: baseId + 2,
            symbol: 'CSPX',
            name: 'iShares Core S&P 500 UCITS',
            shares: 12,
            costBasis: 450.00,
            currentPrice: 520.30,
            currency: 'USD',
            groupId: 1,
            purchaseDate: new Date(`${currentYear - 1}-06-10T12:00:00.000Z`).toISOString()
        },
        {
            id: baseId + 3,
            symbol: 'AVDV',
            name: 'Avantis Intl Small Cap Value',
            shares: 40,
            costBasis: 62.30,
            currentPrice: 67.80,
            currency: 'USD',
            groupId: 2,
            purchaseDate: new Date(`${currentYear}-01-20T12:00:00.000Z`).toISOString()
        },
        {
            id: baseId + 4,
            symbol: 'AVES',
            name: 'Avantis EM Value ETF',
            shares: 25,
            costBasis: 55.10,
            currentPrice: 58.40,
            currency: 'USD',
            groupId: 2,
            purchaseDate: new Date(`${currentYear}-02-05T12:00:00.000Z`).toISOString()
        },
        {
            id: baseId + 5,
            symbol: '1159235',
            name: 'קסם KTF תל-בונד שקלי 0-3',
            shares: 200,
            costBasis: 105.20,
            currentPrice: 106.80,
            currency: 'ILS',
            groupId: 3,
            purchaseDate: new Date(`${currentYear - 1}-09-12T12:00:00.000Z`).toISOString(),
            isTASE: true
        }
    ];

    const bonds = [
        {
            symbol: '5131784',
            name: 'אלטשולר אגח ממשלתי',
            units: 250,
            costBasis: 112.50,
            currentPrice: 114.20,
            currency: 'ILS',
            purchaseDate: `${currentYear - 1}-03-20`,
            isTASE: true
        },
        {
            symbol: '5122510',
            name: 'מיטב אגח חברות',
            units: 100,
            costBasis: 108.30,
            currentPrice: 109.80,
            currency: 'ILS',
            purchaseDate: `${currentYear}-01-22`,
            isTASE: true
        }
    ];

    const groups = [
        { id: 1, name: 'מדדים עולמיים', target: 60, color: '#3b82f6' },
        { id: 2, name: 'Small Cap Value', target: 30, color: '#10b981' },
        { id: 3, name: 'אג"ח / סולידי', target: 10, color: '#f59e0b' }
    ];

    // ===== Deposits (ILS) =====
    const deposits = [
        {
            id: baseId + 100,
            date: `${currentYear - 1}-03-15`,
            amount: 50000,
            currency: 'ILS',
            note: 'הפקדה ראשונית'
        },
        {
            id: baseId + 101,
            date: `${currentYear - 1}-06-10`,
            amount: 35000,
            currency: 'ILS',
            note: 'הפקדה נוספת'
        },
        {
            id: baseId + 102,
            date: `${currentYear - 1}-09-10`,
            amount: 25000,
            currency: 'ILS',
            note: 'הפקדה רבעונית'
        },
        {
            id: baseId + 103,
            date: `${currentYear}-01-18`,
            amount: 15000,
            currency: 'ILS',
            note: 'הפקדה חודשית'
        },
        {
            id: baseId + 104,
            date: `${currentYear}-02-03`,
            amount: 10000,
            currency: 'ILS',
            note: 'הפקדה חודשית'
        }
    ];
    // Total deposits: 135,000 ILS

    // ===== Purchases =====
    // VT: 30 × $98.50 = $2,955 → ~10,786 ILS
    // CSPX: 12 × $450 = $5,400 → ~19,710 ILS
    // AVDV: 40 × $62.30 = $2,492 → ~9,096 ILS
    // AVES: 25 × $55.10 = $1,377.50 → ~5,028 ILS
    // 1159235: 200 × 105.20 = 21,040 ILS
    // Bond 5131784: 250 × 112.50 = 28,125 ILS
    // Bond 5122510: 100 × 108.30 = 10,830 ILS
    // Total spent: ~104,615 ILS → remaining cash ~30,385 ILS → cash shown: ~5,200+500*3.65
    const purchases = [
        {
            id: baseId + 200,
            date: new Date(`${currentYear - 1}-03-15T12:00:00`).toISOString(),
            symbol: 'VT',
            shares: 30,
            price: 98.50,
            currency: 'USD',
            amount: 30 * 98.50,
            fee: 0,
            assetType: 'stocks',
            note: 'קנייה: 30 × $98.50'
        },
        {
            id: baseId + 201,
            date: new Date(`${currentYear - 1}-06-10T12:00:00`).toISOString(),
            symbol: 'CSPX',
            shares: 12,
            price: 450.00,
            currency: 'USD',
            amount: 12 * 450.00,
            fee: 0,
            assetType: 'stocks',
            note: 'קנייה: 12 × $450'
        },
        {
            id: baseId + 202,
            date: new Date(`${currentYear - 1}-09-12T12:00:00`).toISOString(),
            symbol: '1159235',
            shares: 200,
            price: 105.20,
            currency: 'ILS',
            amount: 200 * 105.20,
            fee: 0,
            assetType: 'stocks',
            note: 'קנייה: 200 × ₪105.20'
        },
        {
            id: baseId + 203,
            date: new Date(`${currentYear}-01-20T12:00:00`).toISOString(),
            symbol: 'AVDV',
            shares: 40,
            price: 62.30,
            currency: 'USD',
            amount: 40 * 62.30,
            fee: 0,
            assetType: 'stocks',
            note: 'קנייה: 40 × $62.30'
        },
        {
            id: baseId + 204,
            date: new Date(`${currentYear}-02-05T12:00:00`).toISOString(),
            symbol: 'AVES',
            shares: 25,
            price: 55.10,
            currency: 'USD',
            amount: 25 * 55.10,
            fee: 0,
            assetType: 'stocks',
            note: 'קנייה: 25 × $55.10'
        }
    ];

    // ===== Cash flows (for cashFlow tab) =====
    const cashFlows = deposits.map(d => ({
        date: d.date,
        amount: d.amount,
        currency: 'ILS',
        amountILS: d.amount,
        type: 'deposit',
        note: d.note
    }));

    // ===== Snapshots for TWR calculation =====
    // Each snapshot: value_before_flow (portfolio value before deposit), cash_flow (deposit amount)
    const snapshots = [
        {
            id: baseId + 300,
            date: `${currentYear - 1}-03-15`,
            totalValue: 0,
            holdingsValue: 0,
            bondsValue: 0,
            cashValue: 0,
            value_before_flow: 0,
            cash_flow: 50000,
            note: 'הפקדה ראשונית'
        },
        {
            id: baseId + 301,
            date: `${currentYear - 1}-06-10`,
            totalValue: 53200,
            holdingsValue: 11500,
            bondsValue: 28500,
            cashValue: 13200,
            value_before_flow: 53200,
            cash_flow: 35000,
            note: 'הפקדה נוספת'
        },
        {
            id: baseId + 302,
            date: `${currentYear - 1}-09-10`,
            totalValue: 90500,
            holdingsValue: 32800,
            bondsValue: 29200,
            cashValue: 28500,
            value_before_flow: 90500,
            cash_flow: 25000,
            note: 'הפקדה רבעונית'
        },
        {
            id: baseId + 303,
            date: `${currentYear}-01-18`,
            totalValue: 120800,
            holdingsValue: 56200,
            bondsValue: 29800,
            cashValue: 34800,
            value_before_flow: 120800,
            cash_flow: 15000,
            note: 'הפקדה חודשית'
        },
        {
            id: baseId + 304,
            date: `${currentYear}-02-03`,
            totalValue: 138200,
            holdingsValue: 68500,
            bondsValue: 40600,
            cashValue: 29100,
            value_before_flow: 138200,
            cash_flow: 10000,
            note: 'הפקדה חודשית'
        }
    ];

    return {
        holdings,
        bonds,
        groups,
        snapshots,
        cashFlows,
        rates: { USD: usdRate, EUR: 4.10, USDILS: usdRate },
        cash: { ILS: 5200, USD: 500, EUR: 0 },
        deposits,
        withdrawals: [],
        purchases,
        sales: [],
        transactions: [],
        capitalMovements: [],
        bondsCapitalMovements: [],
        bondsSales: [],
        portfolioSnapshots: []
    };
}

// Check if we're in demo mode
function isDemoMode() {
    return sessionStorage.getItem('demoMode') === 'true';
}

// Enter demo mode
function enterDemoMode() {
    sessionStorage.setItem('demoMode', 'true');
}

// Exit demo mode
function exitDemoMode() {
    sessionStorage.removeItem('demoMode');
}

// Get the demo user object
function getDemoUser() {
    return DEMO_USER;
}

export { isDemoMode, enterDemoMode, exitDemoMode, getDemoUser, generateDemoFinanceData, generateDemoPortfolioData, DEMO_USER };
