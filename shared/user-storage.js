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
        'finance_cachedSummary',
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
        'ai_model'
    ];

    // Keys this app used to write and no longer does. They are deleted on every
    // load, from the plain slot and from every user's archive, without being
    // read first — the point of removing a credential is that nothing looks at
    // it on the way out.
    //
    // 'ai_api_key' held an Anthropic key. It was reachable by any script on
    // this origin, and it survived a user swap inside `u::<uid>::ai_api_key`,
    // so dropping it from USER_KEYS alone would have left those copies behind
    // forever with nothing left to archive or restore them.
    var RETIRED_KEYS = ['ai_api_key'];

    var ACTIVE_KEY = 'ft_active_uid';
    var DEMO_UID = 'demo-user-readonly';
    var PRE_DEMO_UID = '__unclaimed_before_demo__';
    var PRE_DEMO_KEY = 'ft_pre_demo_unclaimed';

    function nsKey(uid, key) {
        return 'u::' + uid + '::' + key;
    }

    /**
     * Delete every retired key: the plain slot and `u::<any uid>::<key>`.
     * Collect first, then delete — removing during the index walk shifts the
     * remaining keys down and skips half of them.
     */
    function purgeRetiredKeys() {
        var doomed = [];
        try {
            for (var i = 0; i < localStorage.length; i++) {
                var name = localStorage.key(i);
                if (!name) continue;
                for (var j = 0; j < RETIRED_KEYS.length; j++) {
                    var retired = RETIRED_KEYS[j];
                    if (name === retired || (name.indexOf('u::') === 0 && name.slice(-(retired.length + 2)) === '::' + retired)) {
                        doomed.push(name);
                    }
                }
            }
            doomed.forEach(function (name) { localStorage.removeItem(name); });
        } catch (e) {
            // Storage blocked entirely — nothing stored, nothing to purge.
        }
        return doomed.length;
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

    function hasArchive(uid) {
        return USER_KEYS.some(function (k) { return localStorage.getItem(nsKey(uid, k)) !== null; });
    }

    /** Merge a preserved archive into a real account without replacing newer account data. */
    function mergeArchive(fromUid, toUid) {
        USER_KEYS.forEach(function (k) {
            var sourceKey = nsKey(fromUid, k);
            var targetKey = nsKey(toUid, k);
            var source = localStorage.getItem(sourceKey);
            if (source !== null && localStorage.getItem(targetKey) === null) {
                localStorage.setItem(targetKey, source);
            }
            localStorage.removeItem(sourceKey);
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
        beginOwnershipTransition();
        var active = localStorage.getItem(ACTIVE_KEY);
        if (active === uid) { noteOwnership(uid); return false; } // already this user's data — nothing to do

        if (active) {
            // Another user's data occupies the plain keys — swap.
            archive(active);
            // If demo mode was entered before the old single-user cache had an
            // owner marker, recover that quarantined cache into the first real
            // account that signs in. Never merge it into the demo account.
            if (uid !== DEMO_UID && localStorage.getItem(PRE_DEMO_KEY) === 'true') {
                mergeArchive(PRE_DEMO_UID, uid);
                localStorage.removeItem(PRE_DEMO_KEY);
            }
            restore(uid);
        } else {
            // No active owner recorded. Plain keys may hold pre-isolation data
            // (the original single-user install) — adopt each key for this uid
            // unless the uid already has its own archived copy (post-logout case).
            if (uid !== DEMO_UID && localStorage.getItem(PRE_DEMO_KEY) === 'true') {
                mergeArchive(PRE_DEMO_UID, uid);
                localStorage.removeItem(PRE_DEMO_KEY);
            }
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
        noteOwnership(uid);
        return true;
    }

    /**
     * Move all plain user data out of reach before demo mode starts.
     * Unlike syncToUser(DEMO_UID), an unowned legacy cache is quarantined rather
     * than adopted by the fictitious demo account.
     */
    function enterDemoSandbox() {
        beginOwnershipTransition();
        var active = localStorage.getItem(ACTIVE_KEY);
        if (active === DEMO_UID) {
            // Already inside the sandbox: the plain keys ARE the demo data.
            // restore() deletes every key with no archived copy, and
            // seedDemoStorage() writes the plain keys directly rather than the
            // archive — so restoring here erased the whole demo dataset on each
            // page load, leaving demo users an empty mortgage and empty caches.
            noteOwnership(DEMO_UID);
            return false;
        }
        if (active) {
            archive(active);
        } else {
            archive(PRE_DEMO_UID);
            if (hasArchive(PRE_DEMO_UID)) localStorage.setItem(PRE_DEMO_KEY, 'true');
        }
        restore(DEMO_UID);
        localStorage.setItem(ACTIVE_KEY, DEMO_UID);
        noteOwnership(DEMO_UID);
        return true;
    }

    /** Archive the disposable demo cache and leave no private/plain keys behind. */
    function exitDemoSandbox() {
        beginOwnershipTransition();
        var active = localStorage.getItem(ACTIVE_KEY);
        if (active === DEMO_UID) archive(DEMO_UID);
        else USER_KEYS.forEach(function (k) { localStorage.removeItem(k); });
        localStorage.removeItem(ACTIVE_KEY);
        noteOwnership(null);
    }

    /** Archive the active user's data and clear the plain keys. Call BEFORE signOut. */
    function clearOnLogout() {
        beginOwnershipTransition();
        var active = localStorage.getItem(ACTIVE_KEY);
        if (active) {
            archive(active);
        } else {
            // Unknown owner — do not guess; just make sure nothing leaks.
            USER_KEYS.forEach(function (k) { localStorage.removeItem(k); });
        }
        localStorage.removeItem(ACTIVE_KEY);
        noteOwnership(null);
    }

    /** uid that currently owns the plain keys, or null. */
    function activeUid() {
        return localStorage.getItem(ACTIVE_KEY);
    }

    // ── Cross-tab ownership lock (intermediate boundary — see AGENTS.md) ────
    //
    // The plain keys are one shared slot per origin, but every open tab keeps
    // its own copy of the data in memory and its own timers writing it back.
    // Two tabs open at once — a real account and a demo session, or two real
    // accounts on a shared machine — race for that slot: whichever tab last
    // called syncToUser()/enterDemoSandbox() owns it, and the OTHER tab has no
    // idea that just happened. If it goes on writing, it overwrites the new
    // owner's data in place — a real tab could hand its own financial data to
    // a demo tab reading it seconds later, or a demo tab could clobber a real
    // account's cache with fictitious data.
    //
    // The browser already tells every OTHER tab when localStorage changes, via
    // the `storage` event — it never fires in the tab that made the change,
    // which is exactly the one tab that does not need warning. Watching
    // ACTIVE_KEY there catches the instant ownership moves out from under this
    // tab, with no polling.
    //
    // This is the intermediate boundary the wave authorized, not the long-term
    // fix: the real fix is namespaced call sites that read/write `u::<uid>::*`
    // directly and never touch a shared plain key at all, so there is nothing
    // to race for. Until that migration happens, a tab that loses ownership is
    // locked out of the plain keys — reads return null, writes are dropped —
    // and shown a banner, rather than silently mixing its data into whatever
    // the new owner wrote. It recovers by refreshing, or by this same tab
    // calling syncToUser()/enterDemoSandbox() itself (a deliberate re-auth),
    // never on its own.
    var lastKnownOwner = null;
    var ownershipLost = false;
    var lockoutBanner = null;

    function isUserKey(key) {
        return USER_KEYS.indexOf(key) !== -1;
    }

    function hideLockoutBanner() {
        if (lockoutBanner && lockoutBanner.parentNode) lockoutBanner.parentNode.removeChild(lockoutBanner);
        lockoutBanner = null;
    }

    /** This tab claimed (or reclaimed) the plain keys itself — the opposite of losing them. */
    function noteOwnership(uid) {
        lastKnownOwner = uid;
        ownershipLost = false;
        hideLockoutBanner();
    }

    /**
     * Call at the very start of every ownership transition this tab performs
     * itself — syncToUser / enterDemoSandbox / exitDemoSandbox / clearOnLogout.
     *
     * If another tab already swapped the owner out from under this one, this
     * tab is locked out: the guard below drops every read and write of a
     * USER_KEY. But those four functions do their work — archive() and
     * restore() — THROUGH that same guarded localStorage. If the lock is still
     * armed when they run, every plain-key write is silently swallowed: the
     * plain slot keeps the previous owner's bytes while ACTIVE_KEY flips to the
     * new uid, so the tab then reads another account's data out of the shared
     * slot. Clearing the flag up front lets the transition's own archive/
     * restore land; noteOwnership() at the end still records who actually won.
     *
     * This is not a new escape hatch — the guard already names "this same tab
     * calling syncToUser()/enterDemoSandbox() itself" as the recovery path.
     * The reset was just happening one step too late, after the swallowed
     * archive/restore. The banner is left in place until noteOwnership() so a
     * transition that somehow bails early does not look recovered.
     */
    function beginOwnershipTransition() {
        ownershipLost = false;
    }

    function showLockoutBanner() {
        if (lockoutBanner || typeof document === 'undefined' || !document.body) return;
        try {
            var el = document.createElement('div');
            el.id = 'ft-ownership-lock-banner';
            el.setAttribute('role', 'alert');
            el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:999999;' +
                'background:#b91c1c;color:#fff;padding:12px 16px;text-align:center;' +
                'font-family:inherit;direction:rtl;font-size:0.95rem;';
            el.innerHTML = 'לשונית אחרת החליפה משתמש בדפדפן הזה. הנתונים כאן הפסיקו ' +
                'להתעדכן ולהישמר — ' +
                '<button type="button" id="ft-ownership-lock-reload" style="' +
                'margin-inline-start:8px;padding:4px 10px;border-radius:6px;border:none;' +
                'background:#fff;color:#b91c1c;cursor:pointer;font-weight:600;">רענון</button>';
            document.body.appendChild(el);
            var btn = document.getElementById('ft-ownership-lock-reload');
            if (btn) btn.addEventListener('click', function () { window.location.reload(); });
            lockoutBanner = el;
        } catch (e) {
            // No usable DOM — the read/write lock below still holds regardless.
        }
    }

    /** This tab discovered — via the storage event — that another tab took the plain keys. */
    function loseOwnership(newOwner) {
        lastKnownOwner = newOwner;
        if (ownershipLost) return;
        ownershipLost = true;
        showLockoutBanner();
    }

    try {
        if (typeof window !== 'undefined' && window.addEventListener) {
            window.addEventListener('storage', function (e) {
                if (e.key === ACTIVE_KEY && e.newValue !== lastKnownOwner) loseOwnership(e.newValue);
            });
        }
    } catch (e) {
        // No window to attach to (e.g. a non-browser harness) — nothing to guard yet.
    }

    // Every existing call site reads/writes the plain keys through the global
    // `localStorage`, so patching Storage.prototype is the one place this can
    // be enforced without touching five screens' worth of call sites. Only
    // USER_KEYS are gated: the namespaced `u::` archive, ACTIVE_KEY itself and
    // unrelated keys keep working — the lock depends on reading ACTIVE_KEY.
    //
    // Patching the PROTOTYPE, not the `localStorage` instance, is deliberate:
    // Storage instances are exotic objects whose [[Set]] treats an own-property
    // assignment as writing a storage entry, so `localStorage.getItem = fn`
    // does not shadow the method the way it would on an ordinary object.
    // `Storage` is not defined in every harness this file loads under (some
    // tests stand in a plain object for `localStorage`), so this is skipped
    // there rather than throwing — the feature simply does not exist in a
    // context with no real Storage to guard.
    try {
        if (typeof Storage !== 'undefined' && Storage.prototype && !Storage.prototype.__ftOwnershipGuarded) {
            var nativeGetItem = Storage.prototype.getItem;
            var nativeSetItem = Storage.prototype.setItem;
            var nativeRemoveItem = Storage.prototype.removeItem;

            Storage.prototype.getItem = function (key) {
                if (ownershipLost && isUserKey(key)) return null;
                return nativeGetItem.call(this, key);
            };
            Storage.prototype.setItem = function (key, value) {
                if (ownershipLost && isUserKey(key)) return undefined;
                return nativeSetItem.call(this, key, value);
            };
            Storage.prototype.removeItem = function (key) {
                if (ownershipLost && isUserKey(key)) return undefined;
                return nativeRemoveItem.call(this, key);
            };
            Storage.prototype.__ftOwnershipGuarded = true;
        }
    } catch (e) {
        // No Storage global to guard — same as above.
    }

    window.UserStorage = {
        syncToUser: syncToUser,
        clearOnLogout: clearOnLogout,
        enterDemoSandbox: enterDemoSandbox,
        exitDemoSandbox: exitDemoSandbox,
        activeUid: activeUid,
        purgeRetiredKeys: purgeRetiredKeys,
        USER_KEYS: USER_KEYS,
        RETIRED_KEYS: RETIRED_KEYS,
        DEMO_UID: DEMO_UID
    };

    // Runs on every page load, before anything reads storage. This module is
    // the first script on all five screens and on the login page, so there is
    // no window in which a retired credential is still present and readable.
    purgeRetiredKeys();

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
