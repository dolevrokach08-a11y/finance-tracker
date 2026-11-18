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
     *   snapshots   portfolio.snapshots — optional; when given, each complete
     *               group also gets `twr` (see groupTWR)
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
            // TWR needs the same complete flows, plus prices at past snapshots.
            g.twr = o.snapshots && g.status === 'ok' ? groupTWR(g, o, groupOf, nowDay) : null;
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

    // ===================================================================
    // History at a past date — for TWR by group
    // ===================================================================
    //
    // A group's TWR chains its value from one snapshot to the next. The value at
    // snapshot day D is  Σ units(h, D) × price(h, D) × fx(D)  over the holdings
    // in the group today.
    //
    //  - units come from the trade history, never from the stored positions:
    //    trades strictly before D, in D's share basis (splits dated ≤ D applied).
    //    A snapshot's value is "before flow", and every trade dated D is counted
    //    as a flow after it — so the units and the flows can never double count,
    //    whichever order the page happened to write them in.
    //  - price and fx come from snapshot.positions: written live since this
    //    module exists, or rebuilt once by backfillPlan() for older snapshots.
    //    Prices there are always in D's basis, like the units.
    //
    // A snapshot where any holding of the group lacks a price is skipped for that
    // group, not guessed: the period simply runs to the next usable snapshot.

    const unitsTol = u => UNIT_TOLERANCE * Math.max(1, Math.abs(u));

    /** Units of `h` held at the start of `day` (trades dated before it), in that day's basis. */
    function unitsBefore(h, day, purchases, sales, splits) {
        const before = t => { const d = dayOf(t.date); return d !== null && d < day; };
        const buys = (purchases || []).filter(p => tradeBelongsTo(p, h) && before(p));
        const sells = (sales || []).filter(s => tradeBelongsTo(s, h) && before(s));
        const splitsThen = (splits || []).filter(s => typeof s.date === 'string' && s.date <= day);
        const Splits = globalThis.FTSplits;
        if (Splits) return Splits.fromHistory(buys, sells, splitsThen).shares;
        return buys.reduce((s, p) => s + unitsOf(p), 0) - sells.reduce((s, x) => s + unitsOf(x), 0);
    }

    /**
     * Factor that turns a price restated in today's basis (Yahoo's `close`) into
     * the basis of `day`: × to/from for every split of `h` dated after `day`.
     */
    function toDayBasis(h, day, splits) {
        const Splits = globalThis.FTSplits;
        let f = 1;
        for (const s of splits || []) {
            if (!(typeof s.date === 'string' && s.date > day)) continue;
            const applies = Splits ? Splits.appliesTo(s, { assetId: h.id, symbol: h.symbol })
                : String(s.symbol || '').toUpperCase() === String(h.symbol || '').toUpperCase();
            if (applies && Number(s.from) > 0 && Number(s.to) > 0) f *= Number(s.to) / Number(s.from);
        }
        return f;
    }

    /** Close on `day`, else the last one before it, at most `maxBack` calendar days back. */
    function closeOnOrBefore(closes, day, maxBack = 7) {
        if (!closes) return null;
        let t = dayMs(day);
        for (let i = 0; i <= maxBack; i++, t -= DAY_MS) {
            const d = new Date(t).toISOString().slice(0, 10);
            const v = num(closes[d]);
            if (v > 0) return { price: v, day: d };
        }
        return null;
    }

    /**
     * Rebuild positions for snapshots that have none.
     *
     * @param o.snapshots, holdings, purchases, sales, splits
     * @param o.seriesFor  holding → { closes: {day: price}, basis: 'day'|'today',
     *                     currency, source } | null. TASE files give 'day' (raw
     *                     close); Yahoo's close is split-adjusted, so 'today'.
     * @param o.rateFor    (currency, day) → ILS per unit, used only when the
     *                     snapshot has no locked exchange_rates.
     * @returns [{ snapshotId, day, positions, missing: [{symbol, reason}] }]
     *   Only current holdings are rebuilt: sold-out and deleted holdings belong to
     *   no group, and bonds and cash are not in groups. `positions.backfill` says so.
     */
    function backfillPlan(o) {
        const out = [];
        for (const snap of o.snapshots || []) {
            if (snap.positions) continue;
            const day = dayOf(snap.date);
            if (!day) continue;
            const missing = [];
            const rows = [];
            const locked = snap.exchange_rates || {};
            const rates = {};
            for (const h of o.holdings || []) {
                const units = unitsBefore(h, day, o.purchases, o.sales, o.splits);
                if (!(units > unitsTol(units))) continue;
                const cur = h.currency || 'ILS';
                if (cur !== 'ILS' && !(rates[cur] > 0)) {
                    const r = num(locked[cur]) > 0 ? num(locked[cur]) : num(o.rateFor ? o.rateFor(cur, day) : NaN);
                    if (r > 0) rates[cur] = r;
                    else { missing.push({ symbol: h.symbol, reason: 'fx' }); continue; }
                }
                const s = o.seriesFor ? o.seriesFor(h) : null;
                if (!s) { missing.push({ symbol: h.symbol, reason: 'no-series' }); continue; }
                if (s.currency && s.currency !== cur) { missing.push({ symbol: h.symbol, reason: 'currency' }); continue; }
                const hit = closeOnOrBefore(s.closes, day);
                if (!hit) { missing.push({ symbol: h.symbol, reason: 'no-price' }); continue; }
                const price = s.basis === 'today' ? hit.price * toDayBasis(h, day, o.splits) : hit.price;
                rows.push({
                    id: h.id ?? null, symbol: h.symbol ?? null,
                    groupId: Number.isFinite(parseInt(h.groupId, 10)) ? parseInt(h.groupId, 10) : null,
                    shares: units, price, currency: cur,
                    source: s.source || null, priceDay: hit.day,
                });
            }
            out.push({
                snapshotId: snap.id ?? null,
                snapshot: snap,          // the object itself, so the caller writes to the right one
                day,
                missing,
                positions: {
                    holdings: rows, bonds: [], cash: {}, rates,
                    backfill: { scope: 'current-holdings', missing: missing.map(m => m.symbol) },
                },
            });
        }
        return out;
    }

    /** ILS value at snapshot `snap` of the holdings in group `gid`, or null if any is unpriced. */
    function groupValueAt(snap, gid, o, groupOf) {
        const pos = snap.positions;
        const day = dayOf(snap.date);
        if (!pos || !Array.isArray(pos.holdings) || !day) return null;
        let v = 0;
        for (const h of o.holdings || []) {
            if (groupOf(h) !== gid) continue;
            const units = unitsBefore(h, day, o.purchases, o.sales, o.splits);
            if (!(Math.abs(units) > unitsTol(units))) continue;
            const p = pos.holdings.find(x => x.id != null && x.id === h.id)
                || pos.holdings.find(x => x.symbol === h.symbol);
            const cur = h.currency || 'ILS';
            if (!p || !(num(p.price) > 0) || (p.currency && p.currency !== cur)) return null;
            const rate = cur === 'ILS' ? 1 : num((pos.rates || {})[cur]);
            if (!(rate > 0)) return null;
            v += units * num(p.price) * rate;
        }
        return v;
    }

    /**
     * TWR of one group from build()'s flows and today's value: Modified Dietz
     * inside each period between usable snapshots, periods chained. Flows on a
     * snapshot's day fall after it (its value is before flow); flows today fall
     * before today's value.
     */
    function groupTWR(g, o, groupOf, nowDay) {
        const points = [];
        const seen = new Set();
        const snaps = [...(o.snapshots || [])].sort((a, b) => new Date(a.date) - new Date(b.date));
        for (const s of snaps) {
            const day = dayOf(s.date);
            if (!day || seen.has(day) || day >= nowDay) continue;
            const v = groupValueAt(s, g.id, o, groupOf);
            if (v === null) continue;
            seen.add(day);
            points.push({ day, v });
        }
        if (!points.length) return { reason: 'no-snapshots' };
        points.push({ day: nowDay, v: g.valueILS, end: true });

        const inflows = g.flows.map(f => ({ day: f.day, F: -f.v }));  // purchase → money into the group
        let factor = 1, fromDay = null, periods = 0;
        for (let i = 0; i + 1 < points.length; i++) {
            const a = points[i], b = points[i + 1];
            const inPeriod = inflows.filter(f => f.day >= a.day && (b.end ? f.day <= b.day : f.day < b.day));
            if (a.v === 0 && b.v === 0 && !inPeriod.length) continue;   // group not held yet
            // A group that is empty at the snapshot starts at its first purchase.
            // Weighting from the snapshot instead would count the empty days as
            // invested at zero and overstate the return (a lone buy-and-hold would
            // not come out as its price change).
            const start = a.v === 0 && inPeriod.length ? inPeriod.map(f => f.day).sort()[0] : a.day;
            const len = dayMs(b.day) - dayMs(start);
            let F = 0, wF = 0;
            for (const f of inPeriod) {
                F += f.F;
                wF += f.F * (len > 0 ? (dayMs(b.day) - dayMs(f.day)) / len : 1);
            }
            const denom = a.v + wF;
            if (!(denom > 0)) return { reason: 'unstable', day: a.day };
            factor *= 1 + (b.v - a.v - F) / denom;
            if (fromDay === null) fromDay = start;
            periods++;
        }
        if (fromDay === null) return { reason: 'no-snapshots' };
        const years = (dayMs(nowDay) - dayMs(fromDay)) / DAY_MS / YEAR_DAYS;
        return {
            totalPct: (factor - 1) * 100,
            annualPct: years >= 1 && factor > 0 ? (Math.pow(factor, 1 / years) - 1) * 100 : null,
            fromDay,
            years,
            periods,
            // A flow before the first usable snapshot is outside the window measured.
            startsLate: g.flows.some(f => f.day < fromDay),
        };
    }

    // ------------------------------------------------------ TASE csv import

    const cellsOf = (line, delim) => {
        const out = [];
        let cur = '', q = false;
        for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (q) {
                if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
                else if (c === '"') q = false;
                else cur += c;
            } else if (c === '"') q = true;
            else if (c === delim) { out.push(cur.trim()); cur = ''; }
            else cur += c;
        }
        out.push(cur.trim());
        return out;
    };
    const parseNumber = s => {
        const t = String(s || '').replace(/[\s,₪"']/g, '').replace(/[‎‏‪-‮]/g, '');
        return t === '' || t === '-' ? NaN : Number(t);
    };
    const parseDay = s => {
        const t = String(s || '').replace(/[‎‏‪-‮]/g, '').trim();
        let m = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
        if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
        m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
        return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
    };
    const securityKey = s => String(s || '').replace(/^0+/, '');

    /**
     * End-of-day history exported from market.tase.co.il (CSV or TSV).
     * Reads the raw closing price — "שער נעילה", not "שער נעילה מתואם", which
     * is restated for distributions and would misstate a past value — and
     * converts agorot to shekels, the unit the app stores Israeli prices in.
     * The security number is taken from the text above the table, else from
     * the file name; without one the caller must say which holding it is.
     * @returns { security|null, closes: {day: ILS}, rows, first, last } or { error }
     */
    function parseTaseCsv(text, filename) {
        const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/);
        const hi = lines.findIndex(l => /תאריך/.test(l));
        if (hi < 0) return { error: 'no-header' };
        const headLine = lines[hi];
        const delim = ['\t', ';', ','].map(d => [d, headLine.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
        const head = cellsOf(headLine, delim);
        const dateCol = head.findIndex(h => /תאריך/.test(h));
        const closeCols = head.map((h, i) => [h, i]).filter(([h]) => /שער\s*נעילה/.test(h) && !/מתואם/.test(h));
        if (!closeCols.length) return { error: 'no-close-column' };
        const [closeHead, closeCol] = closeCols.find(([h]) => /אגורות/.test(h)) || closeCols[0];
        const agorot = /אגורות/.test(closeHead);
        if (!agorot && !/₪|שקל|ש"ח/.test(closeHead)) return { error: 'unknown-unit', header: closeHead };

        const closes = {};
        let rows = 0;
        for (const line of lines.slice(hi + 1)) {
            if (!line.trim()) continue;
            const c = cellsOf(line, delim);
            const day = parseDay(c[dateCol]);
            const v = parseNumber(c[closeCol]);
            if (!day || !(v > 0)) continue;
            closes[day] = agorot ? v / 100 : v;
            rows++;
        }
        if (!rows) return { error: 'no-rows' };
        const above = lines.slice(0, hi).join(' ');
        const m = above.match(/(?:^|\D)(0?\d{6,8})(?:\D|$)/) || String(filename || '').match(/(?:^|\D)(0?\d{6,8})(?:\D|$)/);
        const days = Object.keys(closes).sort();
        return { security: m ? securityKey(m[1]) : null, closes, rows, first: days[0], last: days[days.length - 1] };
    }

    const api = {
        build, xirr, snapshotPositions, backfillPlan, parseTaseCsv, securityKey,
        _read: { purchaseILS, saleILS, dividendILS },
        _history: { unitsBefore, toDayBasis, closeOnOrBefore, groupValueAt },
    };
    if (typeof window !== 'undefined') window.FTGroupReturns = api;
    if (typeof globalThis !== 'undefined') globalThis.FTGroupReturns = api;
})();
