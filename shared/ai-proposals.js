/**
 * Applying the assistant's proposals to the finance data — and taking them back.
 *
 * The assistant never writes. It proposes, the user ticks what they want, and
 * finance.html calls apply() on its own `data` and then saves through its own
 * path, so sync and conflict handling stay exactly what they are for a change
 * made by hand.
 *
 * Three kinds, and nothing else — no deletes, no amounts, no months:
 *   recategorize  move one transaction to another category
 *   add_category  add a category to the income or expense list
 *   add_rule      remember "description contains X → category Y" for imports
 * A target category that does not exist yet is created as part of the change,
 * and the undo record says so.
 *
 * Every proposal carries the state it was made against. A transaction whose
 * category has changed since is skipped, not overwritten: the model saw an
 * older picture than the one on screen.
 */
(function () {
    'use strict';

    const KINDS = new Set(['recategorize', 'add_category', 'add_rule']);
    const TYPES = new Set(['income', 'expense']);
    const MAX_NAME = 60;

    const listFor = (data, type) => {
        const key = type === 'income' ? 'incomeCategories' : 'expenseCategories';
        if (!Array.isArray(data[key])) data[key] = [];
        return data[key];
    };
    const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

    function ensureCategory(data, type, name, undo) {
        const list = listFor(data, type);
        if (list.includes(name)) return false;
        list.push(name);
        undo.push({ op: 'category_added', type, name });
        return true;
    }

    /**
     * Mutates `data`. Returns what happened to each proposal, and an undo list
     * for undo(). Nothing is saved here — the caller saves once, after.
     */
    function apply(data, proposals) {
        const applied = [];
        const skipped = [];
        const undo = [];
        if (!data || !Array.isArray(proposals)) return { applied, skipped, undo };
        if (!Array.isArray(data.transactions)) data.transactions = [];
        if (!Array.isArray(data.categoryRules)) data.categoryRules = [];

        let ruleSeq = 0;
        for (const p of proposals) {
            const skip = (why) => skipped.push({ proposal: p, reason: why });
            if (!p || !KINDS.has(p.kind)) { skip('סוג שינוי לא מוכר'); continue; }
            if (!TYPES.has(p.type)) { skip('סוג (הכנסה/הוצאה) לא תקין'); continue; }

            if (p.kind === 'recategorize') {
                const to = clean(p.to_category);
                if (!to || to.length > MAX_NAME) { skip('קטגוריית יעד לא תקינה'); continue; }
                const tx = data.transactions.find(t => String(t.id) === String(p.tx_id));
                if (!tx) { skip('העסקה לא נמצאה'); continue; }
                if (tx.type !== p.type) { skip('סוג העסקה לא תואם'); continue; }
                const current = tx.cat || '';
                if (current !== clean(p.from_category)) { skip('הקטגוריה השתנתה מאז ההצעה'); continue; }
                if (current === to) { skip('כבר בקטגוריה הזאת'); continue; }
                const created = ensureCategory(data, p.type, to, undo);
                tx.cat = to;
                undo.push({ op: 'recategorized', txId: tx.id, from: current, to });
                applied.push({ proposal: p, createdCategory: created });
                continue;
            }

            if (p.kind === 'add_category') {
                const name = clean(p.to_category);
                if (!name || name.length > MAX_NAME) { skip('שם קטגוריה לא תקין'); continue; }
                if (!ensureCategory(data, p.type, name, undo)) { skip('הקטגוריה כבר קיימת'); continue; }
                applied.push({ proposal: p, createdCategory: true });
                continue;
            }

            // add_rule — the same shape and the same duplicate test as
            // addCategoryRule() in finance.html.
            const keyword = clean(p.keyword);
            const category = clean(p.to_category);
            if (keyword.length < 2 || keyword.length > MAX_NAME) { skip('מילת חיפוש לא תקינה'); continue; }
            if (!category || category.length > MAX_NAME) { skip('קטגוריית יעד לא תקינה'); continue; }
            const exists = data.categoryRules.some(r =>
                String(r.keyword || '').toLowerCase() === keyword.toLowerCase() && r.type === p.type);
            if (exists) { skip('כבר יש כלל למילה הזאת'); continue; }
            const created = ensureCategory(data, p.type, category, undo);
            const rule = { id: Date.now() + (ruleSeq++), keyword, type: p.type, category, earner: null };
            data.categoryRules.push(rule);
            undo.push({ op: 'rule_added', ruleId: rule.id });
            applied.push({ proposal: p, createdCategory: created });
        }

        return { applied, skipped, undo };
    }

    /**
     * Reverses an apply(), newest step first. A step is only reverted when the
     * data still looks the way apply() left it — a transaction recategorized by
     * hand in between keeps the user's choice, and a category that something
     * now uses stays.
     */
    function undo(data, steps) {
        let reverted = 0, kept = 0;
        if (!data || !Array.isArray(steps)) return { reverted, kept };
        for (let i = steps.length - 1; i >= 0; i--) {
            const s = steps[i];
            if (s.op === 'recategorized') {
                const tx = (data.transactions || []).find(t => t.id === s.txId);
                if (tx && (tx.cat || '') === s.to) { tx.cat = s.from; reverted++; } else kept++;
            } else if (s.op === 'rule_added') {
                const before = (data.categoryRules || []).length;
                data.categoryRules = (data.categoryRules || []).filter(r => r.id !== s.ruleId);
                if (data.categoryRules.length < before) reverted++; else kept++;
            } else if (s.op === 'category_added') {
                const list = listFor(data, s.type);
                const inUse = (data.transactions || []).some(t => t.type === s.type && t.cat === s.name) ||
                    (data.categoryRules || []).some(r => r.type === s.type && r.category === s.name);
                const idx = list.indexOf(s.name);
                if (idx >= 0 && !inUse) { list.splice(idx, 1); reverted++; } else kept++;
            }
        }
        return { reverted, kept };
    }

    const api = { apply, undo };
    if (typeof window !== 'undefined') window.FTProposals = api;
    if (typeof globalThis !== 'undefined') globalThis.FTProposals = api;
})();
