/**
 * Applying the assistant's proposals, and taking them back.
 *
 * The assistant only proposes; this is the code that writes. So the tests are
 * about what it refuses: a proposal made against an older picture of the data,
 * a kind it does not know, a field it should not touch — and an undo that must
 * not trample a change the user made by hand in between.
 *
 *   node tests/ai-proposals.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const repoDir = fileURLToPath(new URL('../', import.meta.url));
const sandbox = { Date, JSON, Array, String, Number, Set };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync(path.join(repoDir, 'shared/ai-proposals.js'), 'utf8'), sandbox);
const { apply, undo } = sandbox.FTProposals;

const fresh = () => ({
    transactions: [
        { id: 101, type: 'expense', desc: 'סינמה סיטי', amt: 120, cat: 'קניות', month: '2026-09' },
        { id: 102, type: 'expense', desc: 'נטפליקס', amt: 55, cat: 'אחר', month: '2026-09' },
        { id: 103, type: 'income', desc: 'משכורת', amt: 18500, cat: 'משכורת', month: '2026-09' },
        { id: 104, type: 'expense', desc: 'ללא קטגוריה', amt: 10, month: '2026-09' },
    ],
    incomeCategories: ['משכורת'],
    expenseCategories: ['קניות', 'בילויים', 'אחר'],
    categoryRules: [{ id: 1, keyword: 'סופר', type: 'expense', category: 'מזון', earner: null }],
});
const P = (o) => ({ kind: '', type: 'expense', tx_id: '', from_category: '', to_category: '', keyword: '', reason: '', ...o });
const snapshot = (d) => JSON.stringify(d);

// ── 1. The three kinds do what they say, and nothing else ───────────────────
{
    const data = fresh();
    const before = data.transactions.map(t => ({ amt: t.amt, month: t.month, desc: t.desc, type: t.type }));
    const out = apply(data, [
        P({ kind: 'recategorize', tx_id: '101', from_category: 'קניות', to_category: 'בילויים' }),
        P({ kind: 'add_category', to_category: 'חיות מחמד' }),
        P({ kind: 'add_rule', keyword: 'נטפליקס', to_category: 'בילויים' }),
    ]);
    assert.equal(out.applied.length, 3);
    assert.equal(out.skipped.length, 0);
    assert.equal(data.transactions[0].cat, 'בילויים');
    assert.ok(data.expenseCategories.includes('חיות מחמד'));
    assert.ok(data.categoryRules.some(r => r.keyword === 'נטפליקס' && r.category === 'בילויים' && r.type === 'expense'));
    assert.equal(data.transactions[1].cat, 'אחר', 'a rule is for future imports — it does not move existing rows');
    assert.deepEqual(data.transactions.map(t => ({ amt: t.amt, month: t.month, desc: t.desc, type: t.type })), before,
        'amounts, months, descriptions and types are never touched');
}

// ── 2. A target category that does not exist is created with the change ────
{
    const data = fresh();
    const out = apply(data, [P({ kind: 'recategorize', tx_id: '102', from_category: 'אחר', to_category: 'מנויים' })]);
    assert.equal(out.applied[0].createdCategory, true);
    assert.ok(data.expenseCategories.includes('מנויים'));
    assert.ok(!data.incomeCategories.includes('מנויים'), 'created on the matching side only');
    assert.equal(data.transactions[1].cat, 'מנויים');
}

// ── 3. Stale and malformed proposals are skipped, not forced ────────────────
{
    const data = fresh();
    const out = apply(data, [
        P({ kind: 'recategorize', tx_id: '101', from_category: 'מזון', to_category: 'בילויים' }),   // stale
        P({ kind: 'recategorize', tx_id: '999', from_category: 'אחר', to_category: 'בילויים' }),     // missing
        P({ kind: 'recategorize', tx_id: '103', type: 'expense', from_category: 'משכורת', to_category: 'בילויים' }), // wrong side
        P({ kind: 'recategorize', tx_id: '101', from_category: 'קניות', to_category: '   ' }),        // empty target
        P({ kind: 'delete_transaction', tx_id: '101' }),                                              // unknown kind
        P({ kind: 'add_category', type: 'transfer', to_category: 'x' }),                              // bad type
        P({ kind: 'add_category', to_category: 'קניות' }),                                            // exists
        P({ kind: 'add_rule', keyword: 'סופר', to_category: 'מזון' }),                                // duplicate rule
        P({ kind: 'add_rule', keyword: 'א', to_category: 'מזון' }),                                   // keyword too short
        null,
    ]);
    assert.equal(out.applied.length, 0);
    assert.equal(out.skipped.length, 10);
    assert.equal(snapshot(data), snapshot(fresh()), 'nothing at all changed');
    assert.equal(out.skipped[0].reason, 'הקטגוריה השתנתה מאז ההצעה');
}

// ── 4. A transaction with no category matches an empty from_category ───────
{
    const data = fresh();
    const out = apply(data, [P({ kind: 'recategorize', tx_id: '104', from_category: '', to_category: 'אחר' })]);
    assert.equal(out.applied.length, 1);
    assert.equal(data.transactions[3].cat, 'אחר');
}

// ── 5. Undo puts everything back ────────────────────────────────────────────
{
    const data = fresh();
    const out = apply(data, [
        P({ kind: 'recategorize', tx_id: '102', from_category: 'אחר', to_category: 'מנויים' }),
        P({ kind: 'add_rule', keyword: 'דיסני', to_category: 'מנויים' }),
        P({ kind: 'add_category', type: 'income', to_category: 'מתנות' }),
    ]);
    const r = undo(data, out.undo);
    assert.equal(r.kept, 0);
    assert.equal(snapshot(data), snapshot(fresh()), 'undo restores the exact previous state');
}

// ── 6. Undo does not overwrite what the user did in between ─────────────────
{
    const data = fresh();
    const out = apply(data, [P({ kind: 'recategorize', tx_id: '102', from_category: 'אחר', to_category: 'מנויים' })]);
    data.transactions[1].cat = 'בילויים';            // the user changed it by hand
    data.transactions[0].cat = 'מנויים';             // and put something else in the new category
    const r = undo(data, out.undo);
    assert.equal(data.transactions[1].cat, 'בילויים', 'the user\'s later choice stands');
    assert.ok(data.expenseCategories.includes('מנויים'), 'a category now in use is not removed');
    assert.equal(r.reverted, 0);
    assert.equal(r.kept, 2);
}

console.log('✓ ai proposals: three kinds, stale guard, honest undo');
