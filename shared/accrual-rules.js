/**
 * Accrual-month rules — which month a row *belongs* to, remembered per merchant.
 *
 * Two flags decide where a row lands on accrual basis (finance.html →
 * computeAssignedMonth):
 *   income  · assignToCurrentMonth  — stays in the month it was received
 *                                     (default: shifts back one, salary = month worked)
 *   expense · assignToPreviousMonth — billed in arrears, shifts back one
 *                                     (default: the purchase's calendar month)
 *
 * Both used to be set row by row, so a nursery or an electricity bill had to be
 * ticked again every month, and a missed tick bent the accrual charts without a
 * trace. A rule says it once: a row whose description contains the keyword
 * inherits the flag. The row's own boolean still wins, in both directions —
 * `false` is stored precisely to say "not this one, whatever the rule says".
 *
 * Rules are read when the month is computed, not stamped on rows at write time.
 * That is deliberate: a rule added today also corrects the months that were
 * missed, which is the point. It also means adding or removing a rule moves
 * numbers, so every UI path that does either shows ruleImpact() first.
 *
 * Legacy rows (ctx.legacyBoundary: months up to it hold aggregates without a
 * transaction date) are already shifted back one month by finance.html, so a rule
 * never reaches them — it would shift them twice.
 *
 * Income rows already inherited the flag from a matching fixed-income template
 * (range-bound). That logic moved here unchanged so both sources sit in one place.
 */
(function () {
    'use strict';

    const FLAG = { income: 'assignToCurrentMonth', expense: 'assignToPreviousMonth' };

    // Merchant descriptions carry branch numbers and terminal ids ("שופרסל 1234"),
    // so the same shop arrives as a dozen strings. Runs of 3+ digits are noise;
    // shorter ones ("7 אחים") are part of the name. Punctuation becomes a word break,
    // so "NETFLIX.COM" and "סופר - קניות" split into words the matcher can compare.
    const _norm = new Map();
    function normalizeMerchant(s) {
        const key = String(s == null ? '' : s);
        let v = _norm.get(key);
        if (v === undefined) {
            v = key.toLowerCase().replace(/\d{3,}/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
            if (_norm.size > 20000) _norm.clear();
            _norm.set(key, v);
        }
        return v;
    }

    function flagField(type) { return FLAG[type] || null; }

    function ruleFor(tx, rules) {
        if (!tx || !FLAG[tx.type] || !Array.isArray(rules) || !rules.length) return null;
        // Whole words only. A plain substring match made "מים" (water) a rule for
        // "פעמים", "ימים" and "שמים" too, and a rule applies silently to every
        // future import.
        const desc = normalizeMerchant(tx.desc);
        if (!desc) return null;
        const padded = ` ${desc} `;
        for (const r of rules) {
            if (!r || r.type !== tx.type) continue;
            const kw = normalizeMerchant(r.keyword);
            if (kw && padded.includes(` ${kw} `)) return r;
        }
        return null;
    }

    // Loose match, same as the cash summary's: a template and its transaction rarely
    // share an exact description.
    function templateFor(tx, fixedIncomes) {
        if (!tx || tx.type !== 'income' || !tx.desc || !Array.isArray(fixedIncomes)) return null;
        return fixedIncomes.find(f =>
            f && f.assignToCurrentMonth === true &&
            f.description &&
            (tx.desc === f.description || tx.desc.includes(f.description) || f.description.includes(tx.desc)) &&
            // A template introduced from May onwards must not re-shift older rows.
            f.start && f.end && tx.month && tx.month >= f.start && tx.month <= f.end
        ) || null;
    }

    function isLegacy(tx, ctx) {
        const b = ctx && ctx.legacyBoundary;
        return !!(b && tx && !tx.transactionDate && tx.month && tx.month <= b);
    }

    /** Where the flag comes from when the row does not say: 'template' | 'rule' | null. */
    function inheritedSource(tx, ctx) {
        const c = ctx || {};
        if (tx && tx.type === 'income' && templateFor(tx, c.fixedIncomes)) return 'template';
        if (!isLegacy(tx, c) && ruleFor(tx, c.rules)) return 'rule';
        return null;
    }

    function inheritedFlag(tx, ctx) { return inheritedSource(tx, ctx) !== null; }

    /** The flag that actually decides the row's accrual month. */
    function effectiveFlag(tx, ctx) {
        const f = tx && flagField(tx.type);
        if (!f) return false;
        if (typeof tx[f] === 'boolean') return tx[f];
        return inheritedFlag(tx, ctx);
    }

    /**
     * What to store on the row for a checkbox state: undefined when it agrees with
     * what the row would inherit anyway (so a later rule change still reaches it),
     * the boolean otherwise. Storing `false` is what lets a row opt out of a rule.
     */
    function explicitFor(checked, tx, ctx) {
        const want = !!checked;
        const probe = { ...tx };
        const f = flagField(tx && tx.type);
        if (f) delete probe[f];
        return want === inheritedFlag(probe, ctx) ? undefined : want;
    }

    function applyExplicit(tx, checked, ctx) {
        const f = flagField(tx && tx.type);
        if (!f) return tx;
        const v = explicitFor(checked, tx, ctx);
        if (v === undefined) delete tx[f]; else tx[f] = v;
        return tx;
    }

    /** Rows whose effective flag differs between two rule sets. */
    function flagChanges(transactions, ctx, rulesAfter) {
        const after = { ...(ctx || {}), rules: rulesAfter };
        const out = [];
        for (const t of (transactions || [])) {
            if (!t || !FLAG[t.type]) continue;
            const before = effectiveFlag(t, ctx);
            const now = effectiveFlag(t, after);
            if (before !== now) out.push({ tx: t, before, after: now });
        }
        return out;
    }

    /** What adding `rule` would move. */
    function ruleImpact(rule, transactions, ctx) {
        const rules = ((ctx && ctx.rules) || []).concat([rule]);
        return flagChanges(transactions, ctx, rules);
    }

    /** What removing the rule with `ruleId` would move back. */
    function removalImpact(ruleId, transactions, ctx) {
        const rules = ((ctx && ctx.rules) || []).filter(r => r.id !== ruleId);
        return flagChanges(transactions, ctx, rules);
    }

    /**
     * Merchants that have been flagged by hand at least `minFlagged` times and are
     * not yet covered by a rule. Each suggestion says how often it was flagged, how
     * often it was not, and how many rows a rule would actually move — rows that
     * say `false` for themselves are counted as opted out, not as moved.
     */
    function suggestRules(transactions, ctx, opts) {
        const minFlagged = (opts && opts.minFlagged) || 2;
        const groups = new Map();
        for (const t of (transactions || [])) {
            const f = t && flagField(t.type);
            if (!f || isLegacy(t, ctx)) continue;
            const key = normalizeMerchant(t.desc);
            if (!key) continue;
            const gk = t.type + '|' + key;
            let g = groups.get(gk);
            if (!g) { g = { type: t.type, keyword: key, sample: t.desc, rows: [], flagged: 0, optedOut: 0 }; groups.set(gk, g); }
            g.rows.push(t);
            if (t[f] === true) g.flagged++;
            else if (t[f] === false) g.optedOut++;
        }
        const out = [];
        for (const g of groups.values()) {
            if (g.flagged < minFlagged) continue;
            const rule = { id: '__probe__', type: g.type, keyword: g.keyword };
            if (ruleFor({ type: g.type, desc: g.sample }, ctx && ctx.rules)) continue;
            const moves = ruleImpact(rule, transactions, ctx);
            if (!moves.length) continue;
            out.push({
                type: g.type,
                keyword: g.keyword,
                total: g.rows.length,
                flagged: g.flagged,
                optedOut: g.optedOut,
                moves,
            });
        }
        out.sort((a, b) => b.moves.length - a.moves.length || b.flagged - a.flagged);
        return out;
    }

    const api = {
        normalizeMerchant, flagField, ruleFor, templateFor,
        inheritedSource, inheritedFlag, effectiveFlag, explicitFor, applyExplicit,
        ruleImpact, removalImpact, suggestRules,
    };
    if (typeof window !== 'undefined') window.FTAccrual = api;
    if (typeof globalThis !== 'undefined') globalThis.FTAccrual = api;
})();
