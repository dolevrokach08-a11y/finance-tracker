/**
 * Time-weighted return — the one implementation.
 *
 * It needs exactly two inputs: the snapshot list and the portfolio's current
 * value. No network, no DOM, no page state. It lived inside portfolio.html's
 * module scope anyway, which is the only reason the home screen could not call
 * it and fell back to a cost-basis figure under the label "תשואה כוללת" —
 * a different measure answering a different question.
 *
 * Snapshots and their locked exchange rates are the basis for this; they live in
 * the portfolio dataset and sync to Firestore. portfolio_cachedTWR is only a
 * precomputed shortcut, so nothing here depends on it.
 *
 * Pensions are excluded from currentValue by every caller, matching how the rest
 * of the app keeps them out of performance figures.
 */
(function () {
    'use strict';

    // Two readings of a snapshot's opening value, kept exactly as the original
    // wrote them: the single-snapshot branch treats a stored 0 as missing and
    // falls through to totalValue, the chained branch does not.
    function startOfSingle(snap) {
        return (snap.value_before_flow || snap.totalValue || 0) + (snap.cash_flow || 0);
    }
    function valueAt(snap) {
        return snap.value_before_flow !== undefined ? snap.value_before_flow : (snap.totalValue || 0);
    }

    function calculate(rawSnapshots, currentValue) {
        if (!Array.isArray(rawSnapshots) || rawSnapshots.length === 0) return null;
        if (typeof currentValue !== 'number' || isNaN(currentValue)) return null;

        const snapshots = [...rawSnapshots].sort((a, b) => new Date(a.date) - new Date(b.date));
        const yearsSince = date => (new Date() - new Date(date)) / (1000 * 60 * 60 * 24) / 365.25;

        if (snapshots.length === 1) {
            const only = snapshots[0];
            const startValue = startOfSingle(only);
            if (startValue === 0) return null;

            const rLive = (currentValue - startValue) / startValue;
            const years = yearsSince(only.date);
            return {
                total: rLive * 100,
                base: 0,
                live: rLive * 100,
                annualized: years >= 1 ? (Math.pow(1 + rLive, 1 / years) - 1) * 100 : null,
                years,
                periods: 1,
            };
        }

        // Chain the closed periods: each one ends where the next snapshot was
        // measured, before its own cash flow lands.
        const periodicReturns = [];
        for (let i = 1; i < snapshots.length; i++) {
            const prev = snapshots[i - 1];
            const startValue = valueAt(prev) + (prev.cash_flow || 0);
            const endValue = valueAt(snapshots[i]);
            if (startValue > 0 && !isNaN(startValue) && !isNaN(endValue)) {
                periodicReturns.push(1 + (endValue - startValue) / startValue);
            }
        }
        const base = periodicReturns.length > 0
            ? periodicReturns.reduce((acc, factor) => acc * factor, 1) - 1
            : 0;

        // The open period: last snapshot through to today's value.
        const last = snapshots[snapshots.length - 1];
        const startValueLive = valueAt(last) + (last.cash_flow || 0);
        let live = 0;
        if (startValueLive > 0 && !isNaN(startValueLive)) {
            live = (currentValue - startValueLive) / startValueLive;
        }

        const total = (1 + base) * (1 + live) - 1;
        const years = yearsSince(snapshots[0].date);

        return {
            total: total * 100,
            base: base * 100,
            live: live * 100,
            annualized: years >= 1 && total > -1 ? (Math.pow(1 + total, 1 / years) - 1) * 100 : null,
            years,
            periods: periodicReturns.length + 1,
        };
    }

    const api = { calculate };
    if (typeof window !== 'undefined') window.FTPortfolioTWR = api;
    if (typeof globalThis !== 'undefined') globalThis.FTPortfolioTWR = api;
})();
