/**
 * Per-user localStorage isolation (swap-on-auth).
 *
 * Problem this solves: all app data lives under plain localStorage keys
 * ('portfolio', 'financeTrackerData', ...). On a shared browser, user B
 * signing in after user A would fall back to A's local data and then
 * sync it into B's cloud account — a cross-user data leak.
 *
 * Model: the PLAIN keys always belong to exactly one user — the "active"
 * user recorded under ACTIVE_KEY. When a different uid signs in, the plain
 * keys are archived to `u::<oldUid>::<key>` and the incoming user's archive
 * is restored to the plain keys. Logout archives and clears the plain keys.
 * All existing call sites keep using plain keys untouched.
 *
 * Loaded as a classic (non-module) script so it executes before the pages'
 * deferred module scripts. Exposes window.UserStorage.
 */
(function () {
    'use strict';

    // Every localStorage key that holds user-specific data.
    // Theme keys ('theme', 'mortgage-theme') stay global on purpose — cosmetic, not private.
    var USER_KEYS = [
        // primary datasets
        'portfolio',
        'financeTrackerData',
        'financeData',
        'financeData_backup',
        'mortgageData',
        'mortgage',
        'mortgageState',
        'mortgage_monthly_income',
        'taxOptimizerData',
        'taxData',
        // computed caches
        'portfolio_cachedTWR',
        'portfolio_cachedBenchmarks',
        // sync metadata
        'portfolio_sync_meta',
        'financeTrackerData_meta',
        'mortgage_sync_meta',
        // cross-page sync bus
        'ft_sync_manifest',
        'ft_warnings',
        // AI assistant
        'ai_api_key',
        'ai_model'
    ];

    var ACTIVE_KEY = 'ft_active_uid';

    function nsKey(uid, key) {
        return 'u::' + uid + '::' + key;
    }

    /** Copy the plain keys into the uid's namespaced archive, then remove them. */
    function archive(uid) {
        if (!uid) return;
        USER_KEYS.forEach(function (k) {
            var v = localStorage.getItem(k);
            if (v !== null) {
                localStorage.setItem(nsKey(uid, k), v);
            }
            localStorage.removeItem(k);
        });
    }

    /** Populate the plain keys from the uid's namespaced archive (missing → removed). */
    function restore(uid) {
        USER_KEYS.forEach(function (k) {
            var v = localStorage.getItem(nsKey(uid, k));
            if (v !== null) {
                localStorage.setItem(k, v);
            } else {
                localStorage.removeItem(k);
            }
        });
    }

    /**
     * Make the plain keys belong to `uid`. Call on every successful auth
     * (login page + each page's onAuthStateChanged) BEFORE any data load.
     * @returns {boolean} true if ownership changed (callers that already read
     *                    localStorage before auth resolved should reload).
     */
    function syncToUser(uid) {
        if (!uid) return false;
        var active = localStorage.getItem(ACTIVE_KEY);
        if (active === uid) return false; // already this user's data — nothing to do

        if (active) {
            // Another user's data occupies the plain keys — swap.
            archive(active);
            restore(uid);
        } else {
            // No active owner recorded. Plain keys may hold pre-isolation data
            // (the original single-user install) — adopt each key for this uid
            // unless the uid already has its own archived copy (post-logout case).
            USER_KEYS.forEach(function (k) {
                var plain = localStorage.getItem(k);
                var stored = localStorage.getItem(nsKey(uid, k));
                if (plain !== null && stored === null) {
                    localStorage.setItem(nsKey(uid, k), plain);
                }
            });
            restore(uid);
        }
        localStorage.setItem(ACTIVE_KEY, uid);
        return true;
    }

    /** Archive the active user's data and clear the plain keys. Call BEFORE signOut. */
    function clearOnLogout() {
        var active = localStorage.getItem(ACTIVE_KEY);
        if (active) {
            archive(active);
        } else {
            // Unknown owner — do not guess; just make sure nothing leaks.
            USER_KEYS.forEach(function (k) { localStorage.removeItem(k); });
        }
        localStorage.removeItem(ACTIVE_KEY);
    }

    /** uid that currently owns the plain keys, or null. */
    function activeUid() {
        return localStorage.getItem(ACTIVE_KEY);
    }

    window.UserStorage = {
        syncToUser: syncToUser,
        clearOnLogout: clearOnLogout,
        activeUid: activeUid,
        USER_KEYS: USER_KEYS
    };
})();
