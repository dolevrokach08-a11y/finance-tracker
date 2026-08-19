/**
 * Whole-account backup and restore.
 *
 * The per-page exports each cover one dataset. This is the only thing that
 * captures an account in one file, which makes it the last line of defence when
 * something goes wrong — so it errs toward completeness.
 *
 * What it deliberately does NOT carry:
 *   - ai_api_key: a credential. A backup file gets emailed and dropped in cloud
 *     folders; a key must never ride along.
 *   - the computed caches (TWR, benchmarks, month summary): derived from the
 *     data below and regenerated on the next visit. Restoring a stale cache
 *     would show numbers that disagree with the data that produced them.
 *   - the sync metadata: it describes this browser's relationship with the
 *     cloud, not the account. Restore sets it fresh instead.
 */
(function () {
    'use strict';

    // Every key that actually holds account data. Mirrors UserStorage.USER_KEYS
    // minus the credential, the caches and the sync bookkeeping.
    const DATA_KEYS = [
        'portfolio',
        'financeTrackerData',
        'financeData',
        'financeData_backup',
        'mortgageState',            // the tranches — the old backup missed these
        'mortgageData',             // the summary other screens read
        'mortgage',
        'mortgage_monthly_income',
        'taxOptimizerData',
        'taxData',
    ];

    // Restoring data that is newer than the cloud copy has to survive the next
    // sync. Marking it unsynced makes the pages push it up rather than pull over it.
    const META_KEYS = {
        portfolio: 'portfolio_sync_meta',
        financeTrackerData: 'financeTrackerData_meta',
        mortgageData: 'mortgage_sync_meta',
    };

    const LABELS = {
        portfolio: 'תיק השקעות',
        financeTrackerData: 'מעקב כספי',
        mortgageState: 'משכנתא',
        taxOptimizerData: 'מס',
    };

    function readKey(key) {
        try {
            const raw = localStorage.getItem(key);
            return raw === null ? null : JSON.parse(raw);
        } catch {
            return null;
        }
    }

    function collect() {
        const data = {};
        DATA_KEYS.forEach(key => {
            const value = readKey(key);
            if (value !== null) data[key] = value;
        });
        return data;
    }

    /** Human-readable list of what a payload contains, for the confirm dialog. */
    function describe(data) {
        return Object.entries(LABELS)
            .map(([key, label]) => `${data[key] ? '✅' : '❌'} ${label}`)
            .join('\n');
    }

    function exportAll() {
        const data = collect();
        if (Object.keys(data).length === 0) {
            return { ok: false, reason: 'empty' };
        }
        const payload = {
            version: '2.0',
            exportDate: new Date().toISOString(),
            keys: Object.keys(data),
            data,
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `finance-backup-${new Date().toISOString().slice(0, 10)}.json`;
        link.click();
        URL.revokeObjectURL(url);
        return { ok: true, count: Object.keys(data).length, summary: describe(data) };
    }

    function parseBackup(text) {
        const parsed = JSON.parse(text);
        if (!parsed || !parsed.exportDate) throw new Error('קובץ לא תקין — חסר תאריך ייצוא');

        // v1 files came from the old dashboard: three fixed fields, no `data`
        // wrapper, and the mortgage summary stored under the tranches' name.
        if (!parsed.data) {
            const data = {};
            if (parsed.finance) data.financeTrackerData = parsed.finance;
            if (parsed.portfolio) data.portfolio = parsed.portfolio;
            if (parsed.mortgage) data.mortgageData = parsed.mortgage;
            return { exportDate: parsed.exportDate, data, legacy: true };
        }
        return { exportDate: parsed.exportDate, data: parsed.data, legacy: false };
    }

    function restore(data) {
        const now = new Date().toISOString();
        let restored = 0;
        Object.entries(data).forEach(([key, value]) => {
            if (!DATA_KEYS.includes(key)) return;
            try {
                localStorage.setItem(key, JSON.stringify(value));
                restored++;
                const metaKey = META_KEYS[key];
                if (metaKey) {
                    localStorage.setItem(metaKey, JSON.stringify({
                        localLastModified: now,
                        cloudLastModified: null,
                        hasUnsyncedChanges: true,
                    }));
                }
            } catch (e) {
                console.warn('[backup] could not restore ' + key, e);
            }
        });
        return restored;
    }

    const api = { exportAll, parseBackup, restore, describe, DATA_KEYS };
    if (typeof window !== 'undefined') window.FTBackup = api;
    if (typeof globalThis !== 'undefined') globalThis.FTBackup = api;
})();
