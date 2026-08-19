/**
 * Cash-basis month summary — the one implementation.
 *
 * finance.html owns the rules and every other screen has to agree with it, so
 * the rules live here rather than being re-derived per screen. The home card
 * used to compute "fixed income minus fixed expenses", which ignores
 * transactions entirely and therefore showed nothing at all for an account that
 * tracks its month through imported transactions.
 *
 * The three rules that make this more than a sum:
 *   1. A fixed template only contributes when no transaction already covers the
 *      month, otherwise an imported salary is counted twice alongside its template.
 *   2. The tithe is capped at actual profit — a losing month owes nothing.
 *   3. Income flagged titheExempt is outside the tithe base but inside income.
 *
 * Accrual basis stays in finance.html: it needs that page's transaction-level
 * assignment history, and no other screen asks for it.
 */
(function () {
    'use strict';

    function monthsInRange(start, end) {
        if (!start || !end) return [];
        const [sy, sm] = String(start).split('-').map(Number);
        const [ey, em] = String(end).split('-').map(Number);
        if (!sy || !sm || !ey || !em) return [];
        const out = [];
        let cy = sy, cm = sm;
        while (cy < ey || (cy === ey && cm <= em)) {
            out.push(`${cy}-${String(cm).padStart(2, '0')}`);
            cm++;
            if (cm > 12) { cm = 1; cy++; }
        }
        return out;
    }

    function currentMonthKey(now = new Date()) {
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    // Loose match: a template and its imported transaction rarely share an exact
    // description ("משכורת" vs "משכורת - חברת טכנולוגיה").
    function hasMatchingTx(templateDesc, txs) {
        if (!templateDesc) return false;
        return txs.some(t => t.desc && (
            t.desc === templateDesc ||
            t.desc.includes(templateDesc) ||
            templateDesc.includes(t.desc)
        ));
    }

    function monthSummary(data, month) {
        const empty = { inc: 0, exp: 0, bal: 0, tithe: 0, available: 0, hasData: false };
        if (!data || !month) return empty;

        const transactions = Array.isArray(data.transactions) ? data.transactions : [];
        const incomeTxs = transactions.filter(t => t.month === month && t.type === 'income');
        const expenseTxs = transactions.filter(t => t.month === month && t.type === 'expense');

        let inc = incomeTxs.reduce((s, t) => s + (Number(t.amt) || 0), 0);
        let incTaxable = incomeTxs.filter(t => !t.titheExempt).reduce((s, t) => s + (Number(t.amt) || 0), 0);
        let exp = expenseTxs.reduce((s, t) => s + (Number(t.amt) || 0), 0);

        (Array.isArray(data.fixedIncomes) ? data.fixedIncomes : []).forEach(f => {
            if (!monthsInRange(f.start, f.end).includes(month)) return;
            if (hasMatchingTx(f.description, incomeTxs)) return;
            inc += Number(f.amount) || 0;
            incTaxable += Number(f.amount) || 0;
        });
        (Array.isArray(data.fixedExpenses) ? data.fixedExpenses : []).forEach(f => {
            if (!monthsInRange(f.start, f.end).includes(month)) return;
            if (hasMatchingTx(f.description, expenseTxs)) return;
            exp += Number(f.amount) || 0;
        });

        const grossProfit = inc - exp;
        let tithe;
        if (grossProfit <= 0) {
            tithe = 0;
        } else {
            const tenPercent = incTaxable * 0.1;
            tithe = tenPercent > grossProfit ? grossProfit : tenPercent;
        }

        return {
            inc, exp,
            bal: inc - exp,
            tithe,
            available: inc - exp - tithe,
            // Distinguishes "a balanced month" from "nothing recorded yet".
            hasData: incomeTxs.length > 0 || expenseTxs.length > 0 || inc !== 0 || exp !== 0,
        };
    }

    const api = { monthSummary, monthsInRange, currentMonthKey };
    if (typeof window !== 'undefined') window.FTFinance = api;
    if (typeof globalThis !== 'undefined') globalThis.FTFinance = api;
})();
