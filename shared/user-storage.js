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

    // ── Per-browser writer identity (window.FTDevice) ────────────────────
    //
    // Conflict detection used to ask "did the cloud doc change since I loaded
    // it?" and report any change as "another device". That question is wrong:
    // it is also true when THIS browser wrote the doc — from a second tab,
    // from tax-optimizer.html (which writes finance/data), or when a write
    // reached the server but the ack never came back before a refresh. Every
    // one of those produced a scary "another device updated your data" prompt
    // for a write the user made himself.
    //
    // Stamping each cloud write with the writer's id lets the check ask what
    // it actually means: "did a DIFFERENT device write this?".
    //
    // Deliberately NOT in USER_KEYS — identity belongs to the browser, not to
    // the account, and must survive a user swap. Clearing site data mints a
    // new id, which is harmless (worst case: one extra conflict prompt).
    var DEVICE_KEY = 'ft_device_id';
    var _deviceId = null;

    function deviceId() {
        if (_deviceId) return _deviceId;
        try {
            _deviceId = localStorage.getItem(DEVICE_KEY);
            if (!_deviceId) {
                _deviceId = 'd_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
                localStorage.setItem(DEVICE_KEY, _deviceId);
            }
        } catch (e) {
            // Private mode / storage blocked: a per-session id still stops the
            // same page from flagging its own writes as foreign.
            _deviceId = _deviceId || 'd_mem_' + Math.random().toString(36).slice(2, 10);
        }
        return _deviceId;
    }

    /** Short Hebrew description of this browser, shown in conflict prompts. */
    function deviceLabel() {
        var ua = (navigator && navigator.userAgent) || '';
        var isMobile = /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(ua);
        var os = /iPhone|iPad|iPod/i.test(ua) ? 'iOS'
               : /Android/i.test(ua) ? 'Android'
               : /Windows/i.test(ua) ? 'Windows'
               : /Mac OS X|Macintosh/i.test(ua) ? 'Mac'
               : /Linux/i.test(ua) ? 'Linux' : '';
        return (isMobile ? 'פלאפון' : 'מחשב') + (os ? ' (' + os + ')' : '');
    }

    /** The fields to merge into every cloud write. */
    function stamp() {
        return { lastWriterId: deviceId(), lastWriterLabel: deviceLabel() };
    }

    /**
     * True when this browser wrote the given cloud document.
     * Unstamped docs (written before this version shipped) return false, so
     * they keep the old, more cautious behaviour until the next write.
     */
    function wroteIt(docData) {
        return !!(docData && docData.lastWriterId && docData.lastWriterId === deviceId());
    }

    /** Human-readable writer name for prompts, e.g. "פלאפון (Android)". */
    function writerLabel(docData) {
        return (docData && docData.lastWriterLabel) || 'מכשיר אחר';
    }

    /** Field names to strip from a loaded doc before treating it as app data. */
    var STAMP_FIELDS = ['lastWriterId', 'lastWriterLabel'];

    function stripStamp(obj) {
        if (obj) STAMP_FIELDS.forEach(function (f) { delete obj[f]; });
        return obj;
    }

    window.FTDevice = {
        id: deviceId,
        label: deviceLabel,
        stamp: stamp,
        wroteIt: wroteIt,
        writerLabel: writerLabel,
        stripStamp: stripStamp,
        STAMP_FIELDS: STAMP_FIELDS
    };
})();
