/**
 * Capital-gains tax on sales — the single source of truth for how a tax charge
 * or refund is recorded, linked to sales, applied to cash and read back.
 *
 * Two shapes of tax exist and both are read here:
 *
 *  - Embedded (legacy): `sale.tax` written at the time of the sale. It was
 *    already taken off the proceeds and off `sale.profit` (same-currency tax),
 *    or off another currency's cash balance (cross-currency tax). Before
 *    `taxCurrency` existed (commit 392d849) the tax was always in the sale's
 *    own currency, so a missing `taxCurrency` means the sale currency — that is
 *    what the code did, not a guess. Embedded tax is never re-applied to cash.
 *
 *  - Events: `portfolio.taxEvents[]`. One event may cover several sales (an
 *    Israeli broker's cumulative tax), may be a refund (negative amount), may be
 *    in a currency other than the sales', and carries its own date — the day it
 *    left the balance. Sales written since events exist carry `tax: 0`, so their
 *    `profit` is before tax.
 *
 * What an event changes: exactly `cash[event.currency] -= event.amount`. It
 * never touches a sale record (rate, profit, amounts), never creates a deposit,
 * withdrawal or snapshot. Tax is a cost of investing like a commission, not money
 * returned to the investor, so TWR and MWR see it through the portfolio value.
 *
 * How an event is split between its sales (display only — "מס מיוחס"): by each
 * sale's positive pre-tax gain in ILS; a sale at a loss gets none (its effect is
 * the smaller tax on the others). If no linked sale has a gain (a refund after a
 * loss), by the size of each loss. If every gain is zero, equally. The weights
 * are fixed when the event is written, so a later edit to a sale does not move
 * a split the user already saw.
 *
 * Event shape:
 *   { id, date, amount, currency, ils_rate, rates: { [cur]: ilsRate },
 *     saleIds: [...], weights: { [saleId]: w }, provisional, note }
 *   `rates` holds the ILS rate of the event currency and of every linked sale's
 *   currency on the event date, so the tax can be shown in a sale's currency.
 */
(function () {
    'use strict';

    const CURRENCIES = ['ILS', 'USD', 'EUR'];
    const num = v => (typeof v === 'number' ? v : parseFloat(v));
    const finite = v => Number.isFinite(num(v));

    function saleCurrency(sale) {
        return (sale && (sale.original_currency || sale.currency)) || 'ILS';
    }

    /** The tax written into a sale record at the time of the sale, or null. */
    function embeddedTax(sale) {
        if (!sale || !finite(sale.tax) || num(sale.tax) === 0) return null;
        return { amount: num(sale.tax), currency: sale.taxCurrency || saleCurrency(sale) };
    }

    /** The ILS rate of the sale's currency on the sale's day. */
    function saleRate(sale, rateFor) {
        const cur = saleCurrency(sale);
        if (cur === 'ILS') return 1;
        if (finite(sale.ils_rate) && num(sale.ils_rate) > 0) return num(sale.ils_rate);
        const r = rateFor ? num(rateFor(cur, String(sale.date || '').slice(0, 10))) : NaN;
        return r > 0 ? r : NaN;
    }

    /**
     * Profit before any tax, in the sale's currency. `sale.profit` already has
     * embedded tax taken off; this adds it back, converting a cross-currency tax
     * through ILS at the sale day's rate.
     */
    function preTaxProfit(sale, rateFor) {
        const profit = finite(sale.profit) ? num(sale.profit) : 0;
        const t = embeddedTax(sale);
        if (!t) return profit;
        const cur = saleCurrency(sale);
        if (t.currency === cur) return profit + t.amount;
        const rSale = saleRate(sale, rateFor);
        const rTax = t.currency === 'ILS' ? 1
            : (rateFor ? num(rateFor(t.currency, String(sale.date || '').slice(0, 10))) : NaN);
        if (!(rSale > 0) || !(rTax > 0)) return profit; // cannot reconstruct; keep stored
        return profit + t.amount * rTax / rSale;
    }

    function preTaxGainILS(sale, rateFor) {
        const r = saleRate(sale, rateFor);
        return preTaxProfit(sale, rateFor) * (r > 0 ? r : 1);
    }

    /** Weights for splitting one event between `sales`. Sum is 1. */
    function allocationWeights(sales, rateFor) {
        const list = (sales || []).filter(Boolean);
        if (list.length === 0) return {};
        const gains = list.map(s => ({ id: s.id, g: preTaxGainILS(s, rateFor) }));
        let basis = gains.map(x => ({ id: x.id, w: Math.max(0, x.g) }));
        if (basis.every(x => x.w === 0)) basis = gains.map(x => ({ id: x.id, w: Math.max(0, -x.g) }));
        if (basis.every(x => x.w === 0)) basis = gains.map(x => ({ id: x.id, w: 1 }));
        const total = basis.reduce((a, x) => a + x.w, 0);
        const out = {};
        basis.forEach(x => { out[x.id] = x.w / total; });
        return out;
    }

    /**
     * Build a validated event. `rates` must carry the ILS rate of `currency`
     * (unless ILS) and of each linked sale's currency on `date`.
     */
    function buildEvent(o) {
        const amount = num(o.amount);
        const currency = o.currency;
        const sales = (o.sales || []).filter(Boolean);
        const rates = Object.assign({ ILS: 1 }, o.rates || {});
        const errors = [];
        if (!Number.isFinite(amount) || amount === 0) errors.push('amount');
        if (!CURRENCIES.includes(currency)) errors.push('currency');
        if (!/^\d{4}-\d{2}-\d{2}/.test(String(o.date || ''))) errors.push('date');
        if (sales.length === 0) errors.push('sales');
        if (!(num(rates[currency]) > 0)) errors.push('rate');
        if (errors.length) return { errors };
        const event = {
            id: o.id,
            date: o.date,
            amount,
            currency,
            ils_rate: num(rates[currency]),
            ils_rate_source: o.rateSource || null,
            rates,
            saleIds: sales.map(s => s.id),
            weights: o.weights || allocationWeights(sales, o.rateFor),
            provisional: !!o.provisional,
            note: o.note || '',
        };
        return { event };
    }

    /** Cash change one event makes, signed: `apply` with sign -1 undoes it. */
    function applyToCash(cash, event, sign) {
        const s = sign === -1 ? -1 : 1;
        const c = cash || {};
        c[event.currency] = (c[event.currency] || 0) - s * event.amount;
        return c;
    }

    /** Replace `oldEvent` by `newEvent` in cash: undo the old, apply the new. */
    function replaceInCash(cash, oldEvent, newEvent) {
        if (oldEvent) applyToCash(cash, oldEvent, -1);
        if (newEvent) applyToCash(cash, newEvent, 1);
        return cash;
    }

    function eventsForSale(saleId, events) {
        return (events || []).filter(e => Array.isArray(e.saleIds) && e.saleIds.includes(saleId));
    }

    function weightOf(event, saleId) {
        if (event.weights && finite(event.weights[saleId])) return num(event.weights[saleId]);
        const n = (event.saleIds || []).length;
        return n ? 1 / n : 0;
    }

    /** This sale's share of every linked event, in the event's currency and in ILS. */
    function allocatedTax(sale, events) {
        return eventsForSale(sale.id, events).map(e => {
            const w = weightOf(e, sale.id);
            const amount = e.amount * w;
            return { eventId: e.id, amount, currency: e.currency, ils: amount * (e.ils_rate || 1), provisional: !!e.provisional };
        });
    }

    /** Convert an event-allocated amount into the sale's currency at the event day's rates. */
    function inSaleCurrency(part, event, sale, rateFor) {
        const cur = saleCurrency(sale);
        if (part.currency === cur) return part.amount;
        const rTo = cur === 'ILS' ? 1
            : (event.rates && num(event.rates[cur]) > 0 ? num(event.rates[cur]) : saleRate(sale, rateFor));
        return rTo > 0 ? part.ils / rTo : NaN;
    }

    /**
     * Net profit of a sale after all its tax, in the sale's currency.
     * Legacy embedded tax is already inside `sale.profit`; events come off here.
     */
    function netProfit(sale, events, rateFor) {
        const base = finite(sale.profit) ? num(sale.profit) : 0;
        const byId = new Map((events || []).map(e => [e.id, e]));
        return allocatedTax(sale, events).reduce((sum, part) => {
            const v = inSaleCurrency(part, byId.get(part.eventId), sale, rateFor);
            return Number.isFinite(v) ? sum - v : sum;
        }, base);
    }

    /** Total tax on a sale (embedded + allocated events) in ILS, for display. */
    function totalTaxILS(sale, events, rateFor) {
        let ils = 0;
        const t = embeddedTax(sale);
        if (t) {
            const r = t.currency === 'ILS' ? 1
                : (t.currency === saleCurrency(sale) ? saleRate(sale, rateFor)
                    : (rateFor ? num(rateFor(t.currency, String(sale.date || '').slice(0, 10))) : NaN));
            if (r > 0) ils += t.amount * r;
        }
        allocatedTax(sale, events).forEach(p => { ils += p.ils; });
        return ils;
    }

    /** A sale the user marked as still waiting for its tax, with no event linked yet. */
    function isPending(sale, events) {
        return !!(sale && sale.taxPending) && eventsForSale(sale.id, events).length === 0;
    }

    /**
     * ILS value of events, split by the asset type of the linked sales — for the
     * app's implicit-cash ledger, which keeps stocks and bonds apart.
     */
    function eventsILSByAssetType(events, sales) {
        const byId = new Map((sales || []).map(s => [s.id, s]));
        const out = { stocks: 0, bonds: 0 };
        (events || []).forEach(e => {
            (e.saleIds || []).forEach(id => {
                const s = byId.get(id);
                const type = s && s.assetType === 'bonds' ? 'bonds' : 'stocks';
                out[type] += e.amount * (e.ils_rate || 1) * weightOf(e, id);
            });
        });
        return out;
    }

    const api = {
        CURRENCIES,
        saleCurrency, embeddedTax, preTaxProfit, allocationWeights, buildEvent,
        applyToCash, replaceInCash, eventsForSale, allocatedTax, netProfit,
        totalTaxILS, isPending, eventsILSByAssetType,
    };
    if (typeof window !== 'undefined') window.FTSaleTax = api;
    if (typeof globalThis !== 'undefined') globalThis.FTSaleTax = api;
})();
