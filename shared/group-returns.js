/**
 * Return by allocation group — money-weighted (MWR), from the trade history.
 *
 * The portfolio's own MWR (portfolio.html calculateMWR) is an XIRR over deposits,
 * withdrawals and today's value. A group has no deposits: money enters it when a
 * holding in it is bought and leaves when one is sold or pays a dividend. So the
 * flows here are trades, and the closing value is what the group's holdings are
 * worth today.
 *
 * Membership is today's: a holding counts in the group it sits in now, for its
 * whole history. Delete or add a group in the UI and the next call follows it.
 * A holding that was sold out and deleted belongs to no group any more; its trades
 * are returned under `unassigned`, not spread over a group.
 *
 * What is deliberately NOT counted, so the sum of the groups is not the portfolio:
 *  - pensions (no trade history; kept out of performance everywhere in the app),
 *  - bonds (portfolio.bonds has no group),
 *  - cash.
 *
 * Proceeds are before capital-gains tax. Tax depends on when a gain was realised,
 * not on how the group performed, and a sale's tax may be charged to a different
 * currency's cash. The portfolio MWR is after that tax, so the two are not on the
 * same footing — by design.
 *
 * A group whose history cannot be fully reconstructed gets no MWR, only the list
 * of reasons. A plausible-looking number built on a missing purchase is the one
 * outcome this module must not produce. Reasons:
 *  - 'coverage': the holding's units do not match its purchases minus sales
 *    (after splits) — a purchase was never recorded, or the holding was edited.
 *  - 'fx': a foreign-currency flow has no ILS amount and no rate was supplied.
 *  - 'ambiguous': an old-format trade whose `amount` is neither the native total
 *    nor a plausible ILS conversion of it.
 *
 * How a trade's ILS amount is read — the app has written three record shapes:
 *  - currency ILS: the amount is ILS.
 *  - current recorders (have original_amount / originalAmount): `amount` is ILS,
 *    converted at the rate in force when the trade was entered. That is the
 *    figure the rest of the app already treats as the cost (getImplicitCash).
 *  - old format (no original_* fields), foreign currency: if `amount` equals
 *    units × price (+fee) it is native and needs `rateFor`; if it is 2–6× that,
 *    it was already converted; otherwise it is reported as ambiguous.
 *
 * No network, no DOM. The caller supplies today's ILS value of each holding
 * (`valueOf`) and, for native-currency flows, a historical rate (`rateFor`).
 */
(function () {
    'use strict';

    const DAY_MS = 864e5;
    const YEAR_DAYS = 365.25;           // same day count as portfolio.html XNPV
    const UNIT_TOLERANCE = 1e-6;
    const PLAUSIBLE_FX = [2, 6];        // ILS per USD/EUR, wide on purpose

    const num = v => (v === null || v === undefined || v === '' ? NaN : Number(v));
    const has = v => Number.isFinite(num(v));
    const dayOf = d => {
        if (!d) return null;
        if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
        const t = new Date(d);
        return isNaN(t) ? null : t.toISOString().slice(0, 10);
    };
    const dayMs = day => Date.parse(day + 'T00:00:00Z');

    // ---------------------------------------------------------------- XIRR

    function xnpv(rate, flows) {
        const t0 = flows[0].t;
        let npv = 0;
        for (const f of flows) npv += f.v / Math.pow(1 + rate, (f.t - t0) / DAY_MS / YEAR_DAYS);
        return npv;
    }

    /** flows: [{ t: ms, v }], sorted by t. Returns an annual rate (0.1 = 10%) or null. */
    function xirr(flows) {
        if (!Array.isArray(flows) || flows.length < 2) return null;
        if (!flows.some(f => f.v > 0) || !flows.some(f => f.v < 0)) return null;
        const scale = flows.reduce((s, f) => s + Math.abs(f.v), 0);
        const tol = scale * 1e-12;
        const t0 = flows[0].t;

        let rate = 0.1;
        for (let i = 0; i < 100; i++) {
            const npv = xnpv(rate, flows);
            if (Math.abs(npv) <= tol) return rate;
            let d = 0;
            for (const f of flows) {
                const y = (f.t - t0) / DAY_MS / YEAR_DAYS;
                d -= y * f.v / Math.pow(1 + rate, y + 1);
            }
            if (d === 0) break;
            const next = rate - npv / d;
            if (!Number.isFinite(next) || next <= -1 || Math.abs(next) > 100) break;
            if (Math.abs(next - rate) < 1e-12) return next;
            rate = next;
        }

        // Newton failed: bisection on the same bracket the page uses.
        let lo = -0.99, hi = 10;
        let fLo = xnpv(lo, flows);
        if (fLo * xnpv(hi, flows) > 0) return null;
        for (let i = 0; i < 200; i++) {
            const mid = (lo + hi) / 2;
            const fMid = xnpv(mid, flows);
            if (Math.abs(fMid) <= tol || hi - lo < 1e-13) return mid;
            if (fMid * fLo < 0) hi = mid; else { lo = mid; fLo = fMid; }
        }
        return (lo + hi) / 2;
    }

    // ------------------------------------------------------- reading trades

    const currencyOf = r => r.original_currency || r.currency || 'ILS';
    const unitsOf = r => num(r.shares != null ? r.shares : r.units);
    const isRecorded = r => has(r.original_amount) || has(r.originalAmount);

    /** ILS paid for a purchase. → { ils } or { issue } */
    function purchaseILS(p, rateFor) {
        const cur = currencyOf(p);
        const units = unitsOf(p);
        const price = num(p.original_price != null ? p.original_price : p.price);
        const fee = has(p.fee) ? num(p.fee) : 0;
        const nativeTotal = units * price + fee;
        const amount = num(p.amount);

        if (cur === 'ILS') {
            if (has(amount) && amount > 0) return { ils: amount };
            if (Number.isFinite(nativeTotal) && nativeTotal > 0) return { ils: nativeTotal };
            return { issue: 'ambiguous' };
        }
        if (isRecorded(p) && has(amount) && amount > 0) return { ils: amount };
        return foreignOldFormat(amount, nativeTotal, cur, dayOf(p.date), rateFor);
    }

    /** ILS received for a sale, before capital-gains tax. */
    function saleILS(s, rateFor) {
        const cur = currencyOf(s);
        const units = unitsOf(s);
        const commission = has(s.commission) ? num(s.commission) : (has(s.fee) ? num(s.fee) : 0);
        const grossPrice = num(s.original_price != null ? s.original_price : (s.salePrice != null ? s.salePrice : s.price));
        const nativePreTax = has(s.gross_amount)
            ? num(s.gross_amount) - commission
            : units * grossPrice - commission;
        const amount = num(s.amount);

        if (cur === 'ILS') {
            if (Number.isFinite(nativePreTax) && nativePreTax > 0) return { ils: nativePreTax };
            if (has(amount) && amount > 0) return { ils: amount };
            return { issue: 'ambiguous' };
        }
        if (isRecorded(s) && has(amount) && amount > 0) {
            // amount and original_amount are the same net figure in two currencies,
            // so their ratio is the rate the app used when the sale was entered.
            const netNative = has(s.original_amount) ? num(s.original_amount) : num(s.originalAmount);
            if (netNative > 0 && Number.isFinite(nativePreTax) && nativePreTax > 0) {
                return { ils: nativePreTax * (amount / netNative) };
            }
            return { ils: amount };
        }
        return foreignOldFormat(amount, nativePreTax, cur, dayOf(s.date), rateFor);
    }

    function foreignOldFormat(amount, nativeTotal, cur, day, rateFor) {
        if (!has(amount) || !(nativeTotal > 0)) return { issue: 'ambiguous' };
        const ratio = amount / nativeTotal;
        if (Math.abs(ratio - 1) < 0.005) {
            const rate = rateFor ? num(rateFor(cur, day)) : NaN;
            return rate > 0 ? { ils: amount * rate, rateUsed: rate } : { issue: 'fx', currency: cur, day };
        }
        if (ratio >= PLAUSIBLE_FX[0] && ratio <= PLAUSIBLE_FX[1]) return { ils: amount };
        return { issue: 'ambiguous' };
    }

    /** Gross dividend in ILS. Dividends store only a native amount. */
    function dividendILS(d, rateFor) {
        const cur = d.currency || 'ILS';
        const amount = num(d.amount);
        if (!(amount > 0)) return { issue: 'ambiguous' };
        if (cur === 'ILS') return { ils: amount };
        const day = dayOf(d.payDate || d.date);
        const rate = rateFor ? num(rateFor(cur, day)) : NaN;
        return rate > 0 ? { ils: amount * rate, rateUsed: rate } : { issue: 'fx', currency: cur, day };
    }

    // The same matching recalcHoldingFromPurchases uses.
    function tradeBelongsTo(t, h) {
        return (t.assetId && t.assetId === h.id) ||
            (!t.assetId && t.symbol === h.symbol && t.assetType !== 'bonds');
    }

    // --------------------------------------------------------------- build

    /**
     * @param {object} o
     *   groups      portfolio.groups
     *   holdings    portfolio.holdings
     *   purchases   portfolio.purchases
     *   sales       portfolio.sales
     *   dividends   portfolio.dividends
     *   splits      portfolio.splits
     *   valueOf     holding → today's value in ILS
     *   rateFor     (currency, 'YYYY-MM-DD') → ILS per unit, or null
     *   now         Date (default: new Date())
     * @returns {{ groups: object[], unassigned: object[], needsRates: object[] }}
     */
    function build(o) {
        const groups = o.groups || [];
        const holdings = o.holdings || [];
        const purchases = o.purchases || [];
        const sales = o.sales || [];
        const dividends = o.dividends || [];
        const splits = o.splits || [];
        const now = o.now || new Date();
        const nowDay = dayOf(now);
        const Splits = typeof globalThis !== 'undefined' ? globalThis.FTSplits : undefined;

        const unassigned = [];
        const needsRates = [];
        const groupOf = h => {
            const id = parseInt(h.groupId, 10);
            return groups.some(g => g.id === id) ? id : null;
        };

        const out = new Map(groups.map(g => [g.id, {
            id: g.id, name: g.name, color: g.color,
            holdings: [], flows: [], issues: [],
            valueILS: 0, investedILS: 0, returnedILS: 0,
        }]));

        const tradeOwner = t => holdings.find(h => tradeBelongsTo(t, h)) || null;

        for (const h of holdings) {
            const gid = groupOf(h);
            const own = {
                buys: purchases.filter(p => tradeBelongsTo(p, h)),
                sells: sales.filter(s => tradeBelongsTo(s, h)),
            };
            const hist = Splits
                ? Splits.fromHistory(own.buys, own.sells, splits).shares
                : own.buys.reduce((s, p) => s + unitsOf(p), 0) - own.sells.reduce((s, x) => s + unitsOf(x), 0);
            const shares = num(h.shares) || 0;
            const gap = Math.abs(hist - shares) > UNIT_TOLERANCE * Math.max(1, Math.abs(shares))
                ? Math.round((shares - hist) * 1e9) / 1e9 : 0;
            const row = { id: h.id, symbol: h.symbol, shares, historyShares: hist, gap, valueILS: num(o.valueOf(h)) || 0 };

            if (gid === null) { unassigned.push({ kind: 'holding', symbol: h.symbol, reason: 'no-group' }); continue; }
            const g = out.get(gid);
            g.holdings.push(row);
            g.valueILS += row.valueILS;
            if (gap) g.issues.push({ reason: 'coverage', symbol: h.symbol, shares, historyShares: hist });
        }

        const addFlow = (t, kind, read) => {
            const h = kind === 'dividend'
                ? holdings.find(x => x.symbol === t.symbol) || null
                : tradeOwner(t);
            if (!h) {
                if (kind !== 'dividend' && t.assetType === 'bonds') return;  // bonds have no group
                unassigned.push({ kind, symbol: t.symbol, date: dayOf(t.payDate || t.date), reason: 'no-holding' });
                return;
            }
            const gid = groupOf(h);
            if (gid === null) return;
            const g = out.get(gid);
            const day = dayOf(kind === 'dividend' ? (t.payDate || t.date) : t.date);
            if (!day) { g.issues.push({ reason: 'ambiguous', symbol: t.symbol, kind }); return; }
            const r = read(t);
            if (r.issue) {
                g.issues.push({ reason: r.issue, symbol: t.symbol, kind, day, ...(r.currency ? { currency: r.currency } : {}) });
                if (r.issue === 'fx') needsRates.push({ currency: r.currency, day: r.day });
                return;
            }
            const v = kind === 'purchase' ? -r.ils : r.ils;
            g.flows.push({ day, v, kind, symbol: t.symbol });
            if (kind === 'purchase') g.investedILS += r.ils; else g.returnedILS += r.ils;
        };

        for (const p of purchases) addFlow(p, 'purchase', t => purchaseILS(t, o.rateFor));
        for (const s of sales) addFlow(s, 'sale', t => saleILS(t, o.rateFor));
        for (const d of dividends) addFlow(d, 'dividend', t => dividendILS(t, o.rateFor));

        const result = [];
        for (const g of out.values()) {
            g.flows.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
            g.gainILS = g.valueILS + g.returnedILS - g.investedILS;
            g.firstDay = g.flows.length ? g.flows[0].day : null;
            g.years = g.firstDay ? (dayMs(nowDay) - dayMs(g.firstDay)) / DAY_MS / YEAR_DAYS : 0;
            g.mwrPct = null;

            if (!g.holdings.length && !g.flows.length) g.status = 'empty';
            else if (g.issues.length) g.status = 'incomplete';
            else if (g.years < 1 / YEAR_DAYS) g.status = 'too-short';
            else {
                // One flow per day, closing value today — as calculateMWR combines them.
                const byDay = new Map();
                for (const f of g.flows) byDay.set(f.day, (byDay.get(f.day) || 0) + f.v);
                byDay.set(nowDay, (byDay.get(nowDay) || 0) + g.valueILS);
                const flows = [...byDay].sort((a, b) => (a[0] < b[0] ? -1 : 1))
                    .map(([day, v]) => ({ t: dayMs(day), v }));
                const r = xirr(flows);
                if (r === null) g.status = 'no-solution';
                else { g.status = 'ok'; g.mwrPct = r * 100; }
            }
            result.push(g);
        }

        const seen = new Set();
        return {
            groups: result,
            unassigned,
            needsRates: needsRates.filter(n => {
                const k = n.currency + '|' + n.day;
                return seen.has(k) ? false : (seen.add(k), true);
            }),
        };
    }

    // ---------------------------------------------- per-holding snapshot data

    /**
     * What each snapshot stores next to its total, so that a group's value on that
     * date can be read back later for any grouping, including groups that do not
     * exist yet. `groupId` is kept as a record of the time; readers should group by
     * the holding's current group, as build() does.
     * Prices are what the caller valued the snapshot at; `rates` are ILS per unit.
     */
    function snapshotPositions({ holdings, bonds, cash, rates, holdingPrice, bondPrice }) {
        const hp = holdingPrice || (h => h.currentPrice || h.costBasis || 0);
        const bp = bondPrice || (b => b.currentPrice || b.costBasis || 0);
        const pick = (obj, keys) => Object.fromEntries(keys
            .filter(k => obj && typeof obj[k] === 'number' && Number.isFinite(obj[k]))
            .map(k => [k, obj[k]]));
        return {
            holdings: (holdings || []).map((h, i) => ({
                id: h.id ?? null,
                symbol: h.symbol ?? null,
                groupId: Number.isFinite(parseInt(h.groupId, 10)) ? parseInt(h.groupId, 10) : null,
                shares: num(h.shares) || 0,
                price: num(hp(h, i)) || 0,
                currency: h.currency || 'ILS',
            })),
            bonds: (bonds || []).map((b, i) => ({
                id: b.id ?? null,
                symbol: b.symbol ?? null,
                units: num(b.units) || 0,
                price: num(bp(b, i)) || 0,
                currency: b.currency || 'ILS',
            })),
            cash: pick(cash, Object.keys(cash || {})),
            rates: pick(rates, ['USD', 'EUR']),
        };
    }

    const api = { build, xirr, snapshotPositions, _read: { purchaseILS, saleILS, dividendILS } };
    if (typeof window !== 'undefined') window.FTGroupReturns = api;
    if (typeof globalThis !== 'undefined') globalThis.FTGroupReturns = api;
})();
