/**
 * Share splits and reverse splits — how a holding's unit count changes without
 * anyone buying or selling.
 *
 * A split is an event, not an edit. On 2026-10-06 ETHA combined every three units
 * into one; the price tripled and the unit count in the app did not, so the
 * holding showed three times its value. The quick fix — rewrite each purchase to
 * a third of the units at three times the price — keeps the totals but leaves a
 * purchase history that no longer matches the broker's confirmations. Here the
 * purchases stay as the broker wrote them, and the split is read on top of them.
 *
 * Record shape (portfolio.splits[]):
 *   { id, symbol, assetId, date: 'YYYY-MM-DD', tz, from, to, createdAt }
 *   `date` is the first trading day on the new basis. A trade dated before it is
 *   in the old units; a trade on or after it is already in the new ones.
 *   `tz` is the exchange's time zone, and a trade's day is its calendar day *there*.
 *   ETHA's split took effect at the open on 6 Oct on Nasdaq, so a sale at 22:30Z
 *   on 5 Oct — 01:30 on the 6th in Israel, 18:30 on the 5th in New York — was
 *   still on the old basis. Neither the UTC day nor the Israeli day says that for
 *   every exchange; the exchange's own day does. Trades entered through the forms
 *   are stored at noon UTC, which is the same calendar day in every zone this
 *   maps to, so only full timestamps (a sale recorded "now", imports) can differ.
 *   A record without `tz` takes the zone from its symbol (exchangeTimeZone).
 *   `from` → `to`: every `from` units became `to` units. ETHA: from 3, to 1.
 *
 * What a split changes: units ×to/from, per-unit prices ×from/to.
 * What it never changes: any amount — what was paid, what was received, the fee.
 * Every function here keeps that invariant, and the tests hold it to it.
 *
 * Cash in lieu of a fractional unit is not modelled. The broker pays it out as a
 * sale of the fraction, and it is recorded as a sale.
 */
(function () {
    'use strict';

    // Float noise from ×1/3 must not leave 1e-15 units behind a full sale.
    const UNIT_PRECISION = 1e9;
    const roundUnits = n => Math.round(n * UNIT_PRECISION) / UNIT_PRECISION;

    const sym = s => String(s == null ? '' : s).trim().toUpperCase();

    // Yahoo-style suffix → exchange zone. This is a default, never the answer: a
    // symbol does not identify its exchange (CSPX trades in London with no suffix),
    // and an unknown suffix falls to UTC — BHP.AX at 10:30 Sydney would land on the
    // previous day. The dialog lets the user pick the exchange before anything is
    // recorded, and the record keeps what they picked.
    const SUFFIX_TZ = {
        TA: 'Asia/Jerusalem', L: 'Europe/London', AS: 'Europe/Amsterdam',
        DE: 'Europe/Berlin', F: 'Europe/Berlin', PA: 'Europe/Paris', MI: 'Europe/Rome',
        SW: 'Europe/Zurich', TO: 'America/Toronto', AX: 'Australia/Sydney',
        HK: 'Asia/Hong_Kong', T: 'Asia/Tokyo', SI: 'Asia/Singapore', NZ: 'Pacific/Auckland',
    };

    // The shortlist the dialog offers. It is not the limit: the dialog also takes
    // any IANA zone typed in by hand (validate() accepts any zone Intl knows), so an
    // exchange missing from here never forces a wrong date.
    const EXCHANGES = [
        { tz: 'America/New_York', label: 'ניו יורק (NYSE / Nasdaq)' },
        { tz: 'Asia/Jerusalem', label: 'תל אביב' },
        { tz: 'Europe/London', label: 'לונדון' },
        { tz: 'Europe/Amsterdam', label: 'אמסטרדם' },
        { tz: 'Europe/Berlin', label: 'פרנקפורט / קסטרה' },
        { tz: 'Europe/Paris', label: 'פריז' },
        { tz: 'Europe/Rome', label: 'מילאנו' },
        { tz: 'Europe/Zurich', label: 'ציריך' },
        { tz: 'America/Toronto', label: 'טורונטו' },
        { tz: 'Australia/Sydney', label: 'סידני' },
        { tz: 'Asia/Hong_Kong', label: 'הונג קונג' },
        { tz: 'Asia/Tokyo', label: 'טוקיו' },
        { tz: 'Asia/Singapore', label: 'סינגפור' },
        { tz: 'Pacific/Auckland', label: 'אוקלנד (NZX)' },
        { tz: 'UTC', label: 'UTC' },
    ];

    function exchangeTimeZone(symbol) {
        const s = sym(symbol);
        if (!s) return 'UTC';
        if (/^\d{5,9}$/.test(s)) return 'Asia/Jerusalem';
        const dot = s.lastIndexOf('.');
        if (dot < 0) return 'America/New_York';
        return SUFFIX_TZ[s.slice(dot + 1)] || 'UTC';
    }

    const dayFormats = new Map();
    function dayFormat(tz) {
        if (!dayFormats.has(tz)) {
            dayFormats.set(tz, new Intl.DateTimeFormat('en-CA', {
                timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
            }));
        }
        return dayFormats.get(tz);
    }

    function isValidTimeZone(tz) {
        try { dayFormat(tz); return true; } catch (e) { return false; }
    }

    /** The split's exchange zone: its own, else the one its symbol implies. */
    function splitTimeZone(split) {
        return (split && split.tz) || exchangeTimeZone(split && split.symbol);
    }

    /** 'YYYY-MM-DD' of a stored trade date at the given zone, or null. A bare day is taken as is. */
    function dayOf(d, tz) {
        if (!d) return null;
        if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
        const t = new Date(d);
        return isNaN(t) ? null : dayFormat(tz || 'UTC').format(t);
    }

    function isValidDay(s) {
        if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
        const t = new Date(s + 'T00:00:00Z');
        return !isNaN(t) && t.toISOString().slice(0, 10) === s;
    }

    /** Problems with a split record, in Hebrew, for the form. Empty when valid. */
    function validate(split) {
        const errors = [];
        if (!split || !sym(split.symbol)) errors.push('חסר סימול');
        if (!split || !isValidDay(split.date)) errors.push('תאריך לא תקין');
        const from = Number(split && split.from), to = Number(split && split.to);
        if (!(from > 0) || !(to > 0)) errors.push('היחס חייב להיות שני מספרים חיוביים');
        else if (from === to) errors.push('יחס של אחד לאחד אינו פיצול');
        if (split && split.tz != null && !isValidTimeZone(split.tz)) errors.push('אזור זמן לא מוכר');
        return errors;
    }

    /**
     * Does this split belong to the trade? When both carry a holding id, the id
     * decides — two holdings can share a symbol (a regular account and an IRA),
     * and a split recorded on one must not convert the other. Only a trade with
     * no holding id falls back to the symbol, as recalcHoldingFromPurchases does.
     * A trade's own `id` is the trade's, never the holding's, so it is not read.
     */
    function appliesTo(split, trade) {
        if (!split || !trade) return false;
        if (split.assetId != null && trade.assetId != null) {
            return String(split.assetId) === String(trade.assetId);
        }
        return sym(split.symbol) !== '' && sym(split.symbol) === sym(trade.symbol);
    }

    /** Splits that took effect after the trade, oldest first. */
    function splitsAfter(trade, splits) {
        if (!trade || !dayOf(trade.date)) return [];
        return (splits || [])
            .filter(s => validate(s).length === 0 && appliesTo(s, trade) &&
                dayOf(trade.date, splitTimeZone(s)) < s.date)
            .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    }

    /**
     * The trade restated in today's units. Returns the same object when no split
     * applies, a copy otherwise. Units and per-unit prices move; amounts do not.
     */
    function adjustTrade(trade, splits) {
        const after = splitsAfter(trade, splits);
        if (after.length === 0) return trade;
        let shares = Number(trade.shares || 0);
        const out = { ...trade };
        const priceKeys = ['price', 'original_price'].filter(k => trade[k] != null && trade[k] !== '');
        const prices = Object.fromEntries(priceKeys.map(k => [k, Number(trade[k])]));
        for (const s of after) {
            shares = shares * s.to / s.from;
            for (const k of priceKeys) prices[k] = prices[k] * s.from / s.to;
        }
        out.shares = roundUnits(shares);
        Object.assign(out, prices);
        out.splitAdjusted = { originalShares: trade.shares, splits: after.map(s => s.id) };
        return out;
    }

    function adjustTrades(trades, splits) {
        if (!Array.isArray(trades)) return [];
        if (!Array.isArray(splits) || splits.length === 0) return trades;
        return trades.map(t => adjustTrade(t, splits));
    }

    /**
     * Units and average cost from a holding's own history, the way
     * recalcHoldingFromPurchases computes them: average over everything bought,
     * fee included, sales reduce units only. `purchases` and `sales` are already
     * filtered to the holding.
     */
    function fromHistory(purchases, sales, splits) {
        const buys = adjustTrades(purchases || [], splits);
        const sells = adjustTrades(sales || [], splits);
        let bought = 0, cost = 0, sold = 0;
        for (const p of buys) {
            const shares = Number(p.shares || 0);
            const price = Number(p.original_price || p.price || 0);
            const fee = Number(p.fee || 0);
            bought += shares;
            cost += shares * price + (shares > 0 ? fee : 0);
        }
        for (const s of sells) sold += Number(s.shares || 0);
        return {
            shares: roundUnits(bought - sold),
            costBasis: bought > 0 ? cost / bought : 0,
        };
    }

    /**
     * What the holding becomes when `nextSplits` replaces `prevSplits` — one split
     * added, or one removed. Returns { shares, costBasis, method } or { error }.
     *
     * Two ways to get there, and the choice is explicit because they can disagree:
     *  - 'scale': every trade of the holding predates the changed split, so the
     *    whole holding is on one basis. Units ×ratio, cost ÷ratio, nothing else
     *    read. This is exact even when the holding was edited by hand and no
     *    longer matches its purchases.
     *  - 'history': some trades are already on the new basis, so a flat ratio
     *    would convert them twice. The holding is rebuilt from its purchases —
     *    but only if, before the change, the holding agreed with them in both
     *    units and average cost. If it did not, a rebuild would also overwrite
     *    whatever edit made them disagree (a hand-entered cost, say), inside an
     *    action that claims to be a split. That case is refused.
     */
    function planHoldingChange({ holding, purchases, sales, prevSplits, nextSplits, changed }) {
        const from = Number(changed.from), to = Number(changed.to);
        const adding = (nextSplits || []).includes(changed);
        const ratio = adding ? to / from : from / to;

        const trades = [...(purchases || []), ...(sales || [])];
        const onNewBasis = trades.some(t => {
            const d = dayOf(t.date, splitTimeZone(changed));
            return d && d >= changed.date;
        });

        if (!onNewBasis) {
            const shares = Number(holding.shares || 0);
            const costBasis = Number(holding.costBasis || 0);
            return {
                method: 'scale',
                shares: roundUnits(shares * ratio),
                costBasis: costBasis / ratio,
            };
        }

        const before = fromHistory(purchases, sales, prevSplits);
        const held = Number(holding.shares || 0);
        const heldCost = Number(holding.costBasis || 0);
        const unitsOff = Math.abs(before.shares - held) > Math.max(1e-6, Math.abs(held) * 1e-9);
        const costOff = Math.abs(before.costBasis - heldCost) > Math.max(1e-6, Math.abs(heldCost) * 1e-6);
        if (unitsOff || costOff) {
            const gap = unitsOff
                ? `${held} יחידות בהחזקה מול ${before.shares} מההיסטוריה`
                : `עלות ממוצעת ${heldCost} בהחזקה מול ${before.costBasis} מההיסטוריה`;
            return {
                error: 'יש עסקאות אחרי תאריך הפיצול, וההחזקה לא תואמת להיסטוריית הקניות והמכירות שלה ' +
                    `(${gap}). אי אפשר לחשב את הפיצול בלי לשנות גם את הפער הזה.`,
            };
        }
        const after = fromHistory(purchases, sales, nextSplits);
        return { method: 'history', shares: after.shares, costBasis: after.costBasis };
    }

    const api = {
        dayOf, exchangeTimeZone, splitTimeZone, EXCHANGES, validate, appliesTo, splitsAfter, adjustTrade, adjustTrades,
        fromHistory, planHoldingChange, roundUnits,
    };
    if (typeof window !== 'undefined') window.FTSplits = api;
    if (typeof globalThis !== 'undefined') globalThis.FTSplits = api;
})();
