// shared/data.js — shared data layer for all pages (plain script, no modules).
//
// Owns the pieces that used to be copy-pasted per page:
//   * WORKER_BASE — the single Cloudflare Worker origin (was defined 3× with
//     different names/shapes: CF_WORKER_URL, PENDING_API, CF_WORKER_BASE).
//   * DEFAULT_GROUPS + normalizePortfolio() — the portfolio document schema.
//     portfolio.html used to rebuild the object field-by-field in BOTH load
//     paths (Firebase + localStorage); a field added in one place but not the
//     other silently vanished on the next save (this actually happened:
//     `transactions` was missing from the localStorage path).
//   * canLoadLocal() — the uid isolation guard for plain localStorage keys.
//   * readJSON/writeJSON — safe JSON localStorage access.
//
// Deliberately NOT here: each page's save/load orchestration (conflict
// dialogs, SyncWidget states, cloudLoadOk guard). Those flows differ by
// design and are battle-tested — pages keep them.
(function () {
    'use strict';

    // ── Worker endpoints ────────────────────────────────────────────────
    const WORKER_BASE = 'https://finance-proxy.dolevrokach08.workers.dev';

    function proxyUrl(targetUrl) {
        return WORKER_BASE + '/?url=' + encodeURIComponent(targetUrl);
    }

    function pendingApi() {
        return WORKER_BASE + '/api/transactions';
    }

    // ── Portfolio document schema ───────────────────────────────────────
    const DEFAULT_GROUPS = [
        { id: 1, name: 'מדדים עולמיים', target: 60, color: '#3b82f6' },
        { id: 2, name: 'Small Cap Value', target: 30, color: '#10b981' },
        { id: 3, name: 'אקטיבי/סיכוני', target: 10, color: '#ef4444' }
    ];

    function validGroupHoldings(holdings) {
        if (!Array.isArray(holdings)) return [];
        return holdings.map(h => {
            const groupId = parseInt(h.groupId);
            return { ...h, groupId: isNaN(groupId) ? 1 : groupId };
        });
    }

    /**
     * Rebuild a portfolio object from a loaded (cloud or local) document.
     * @param {object} loaded  parsed document
     * @param {object} [opts]
     * @param {'cloud'|'local'} [opts.source]  'local' enables the legacy
     *        numeric-bonds migration and prev-fallbacks that the
     *        localStorage path always had.
     * @param {object} [opts.prev]  the previous in-memory portfolio (used by
     *        the local path as fallback for rates/bonds).
     */
    function normalizePortfolio(loaded, opts) {
        const source = (opts && opts.source) || 'cloud';
        const prev = (opts && opts.prev) || {};

        let bonds;
        if (Array.isArray(loaded.bonds)) {
            bonds = loaded.bonds;
        } else if (source === 'local' && typeof loaded.bonds === 'number' && loaded.bonds > 0) {
            // Legacy format: bonds was a single number → wrap as one fund.
            bonds = [{
                id: Date.now(),
                name: 'קרן אג"ח (מנתונים ישנים)',
                units: 1,
                costBasis: loaded.bonds,
                currentPrice: loaded.bonds,
                lastUpdate: new Date().toISOString()
            }];
        } else {
            bonds = (source === 'local' ? prev.bonds : null) || [];
        }

        const defaultRates = source === 'local'
            ? (prev.rates || { USD: 3.7, EUR: 4.1 })
            : { USD: 3.7, EUR: 4.1 };

        return {
            holdings: validGroupHoldings(loaded.holdings),
            groups: Array.isArray(loaded.groups) && loaded.groups.length > 0 ? loaded.groups : DEFAULT_GROUPS.map(g => ({ ...g })),
            rates: loaded.rates && typeof loaded.rates === 'object' ? loaded.rates : defaultRates,
            bonds: bonds,
            deposits: Array.isArray(loaded.deposits) ? loaded.deposits : [],
            withdrawals: Array.isArray(loaded.withdrawals) ? loaded.withdrawals : [],
            purchases: Array.isArray(loaded.purchases) ? loaded.purchases : [],
            sales: Array.isArray(loaded.sales) ? loaded.sales : [],
            snapshots: Array.isArray(loaded.snapshots) ? loaded.snapshots : [],
            cash: loaded.cash && typeof loaded.cash === 'object' ? loaded.cash : { ILS: 0, USD: 0, EUR: 0 },
            transactions: Array.isArray(loaded.transactions) ? loaded.transactions : [],
            capitalMovements: Array.isArray(loaded.capitalMovements) ? loaded.capitalMovements : [],
            bondsCapitalMovements: Array.isArray(loaded.bondsCapitalMovements) ? loaded.bondsCapitalMovements : [],
            bondsSales: Array.isArray(loaded.bondsSales) ? loaded.bondsSales : [],
            portfolioSnapshots: Array.isArray(loaded.portfolioSnapshots) ? loaded.portfolioSnapshots : [],
            cashFlows: Array.isArray(loaded.cashFlows) ? loaded.cashFlows : [],
            dividends: Array.isArray(loaded.dividends) ? loaded.dividends : [],
            holdingFees: loaded.holdingFees && typeof loaded.holdingFees === 'object' && !Array.isArray(loaded.holdingFees) ? loaded.holdingFees : {},
            watchlist: Array.isArray(loaded.watchlist) ? loaded.watchlist : [],
            pensions: Array.isArray(loaded.pensions) ? loaded.pensions : [],
            // Per-user fees/currency config — MUST survive the rebuild,
            // otherwise ensureAssetConfig would re-seed legacy fees for any
            // account that already has holdings (Phase 2 gotcha).
            assetConfig: loaded.assetConfig && loaded.assetConfig.fees ? loaded.assetConfig : undefined
        };
    }

    // ── localStorage helpers ────────────────────────────────────────────

    /**
     * Isolation guard: plain localStorage keys belong to UserStorage's
     * active uid. Returns false when the signed-in user must NOT read them
     * (they belong to a different account). Demo mode bypasses the guard.
     */
    function canLoadLocal(uid, isDemoMode) {
        if (isDemoMode) return true;
        const US = typeof window !== 'undefined' ? window.UserStorage : null;
        if (!US || !uid) return true;
        const owner = US.activeUid();
        return !owner || owner === uid;
    }

    function readJSON(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            if (raw !== null && raw !== undefined) return JSON.parse(raw);
        } catch (e) { /* corrupt entry → fallback */ }
        return fallback === undefined ? null : fallback;
    }

    function writeJSON(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (e) {
            return false;
        }
    }

    const FTData = {
        WORKER_BASE,
        proxyUrl,
        pendingApi,
        DEFAULT_GROUPS,
        normalizePortfolio,
        canLoadLocal,
        readJSON,
        writeJSON
    };

    if (typeof window !== 'undefined') window.FTData = FTData;
    // Node (unit tests)
    if (typeof module !== 'undefined' && module.exports) module.exports = FTData;
})();
