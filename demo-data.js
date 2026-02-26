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

    const holdings = [
        {
            id: Date.now() + 1,
            symbol: 'VT',
            name: 'Vanguard Total World Stock ETF',
            shares: 45,
            costBasis: 98.50,
            currentPrice: 108.20,
            currency: 'USD',
            groupId: 1,
            purchaseDate: `${currentYear - 1}-03-15`
        },
        {
            id: Date.now() + 2,
            symbol: 'CSPX',
            name: 'iShares Core S&P 500 UCITS',
            shares: 20,
            costBasis: 450.00,
            currentPrice: 520.30,
            currency: 'USD',
            groupId: 1,
            purchaseDate: `${currentYear - 1}-06-10`
        },
        {
            id: Date.now() + 3,
            symbol: 'AVDV',
            name: 'Avantis Intl Small Cap Value',
            shares: 60,
            costBasis: 62.30,
            currentPrice: 67.80,
            currency: 'USD',
            groupId: 2,
            purchaseDate: `${currentYear}-01-20`
        },
        {
            id: Date.now() + 4,
            symbol: 'AVES',
            name: 'Avantis EM Value ETF',
            shares: 35,
            costBasis: 55.10,
            currentPrice: 58.40,
            currency: 'USD',
            groupId: 2,
            purchaseDate: `${currentYear}-02-05`
        },
        {
            id: Date.now() + 5,
            symbol: '1159235',
            name: 'קסם KTF תל-בונד שקלי 0-3',
            shares: 500,
            costBasis: 105.20,
            currentPrice: 106.80,
            currency: 'ILS',
            groupId: 3,
            purchaseDate: `${currentYear - 1}-09-12`,
            isTASE: true
        }
    ];

    const bonds = [
        {
            symbol: '5131784',
            name: 'אלטשולר אגח ממשלתי',
            units: 800,
            costBasis: 112.50,
            currentPrice: 114.20,
            currency: 'ILS',
            purchaseDate: `${currentYear - 1}-04-20`,
            isTASE: true
        },
        {
            symbol: '5122510',
            name: 'מיטב אגח חברות',
            units: 400,
            costBasis: 108.30,
            currentPrice: 109.80,
            currency: 'ILS',
            purchaseDate: `${currentYear}-01-10`,
            isTASE: true
        }
    ];

    const groups = [
        { id: 1, name: 'מדדים עולמיים', target: 60, color: '#3b82f6' },
        { id: 2, name: 'Small Cap Value', target: 30, color: '#10b981' },
        { id: 3, name: 'אג"ח / סולידי', target: 10, color: '#f59e0b' }
    ];

    // Generate some snapshots
    const snapshots = [];
    let baseValue = 85000;
    for (let i = 5; i >= 0; i--) {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        d.setDate(1);
        const change = (Math.random() - 0.3) * 4000;
        baseValue += change;
        snapshots.push({
            date: d.toISOString().split('T')[0],
            totalValue: Math.round(baseValue),
            holdingsValue: Math.round(baseValue * 0.78),
            bondsValue: Math.round(baseValue * 0.18),
            cashValue: Math.round(baseValue * 0.04),
            note: ''
        });
    }

    // Cash flows
    const cashFlows = [
        {
            date: `${currentYear - 1}-03-15`,
            amount: 50000,
            currency: 'ILS',
            amountILS: 50000,
            type: 'deposit',
            note: 'הפקדה ראשונית'
        },
        {
            date: `${currentYear - 1}-06-10`,
            amount: 20000,
            currency: 'ILS',
            amountILS: 20000,
            type: 'deposit',
            note: 'הפקדה נוספת'
        },
        {
            date: `${currentYear}-01-20`,
            amount: 15000,
            currency: 'ILS',
            amountILS: 15000,
            type: 'deposit',
            note: 'הפקדה חודשית'
        }
    ];

    return {
        holdings,
        bonds,
        groups,
        snapshots,
        cashFlows,
        rates: { USD: 3.65, EUR: 4.10, USDILS: 3.65 },
        cash: { ILS: 1250, USD: 340, EUR: 0 },
        deposits: [],
        withdrawals: [],
        purchases: [],
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
