/**
 * What the assistant is told about the finance tracker.
 *
 * It used to get the last 50 entries of the stored array. That array is in
 * entry order, so "the last 50" could be the oldest 50 — the demo data is built
 * newest month first, and the assistant saw nothing from the current month.
 * It also had no month totals, so it summed rows itself and skipped the rules
 * shared/finance-summary.js applies (template dedup, the tithe cap).
 *
 *   node tests/ai-finance-context.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const repoDir = fileURLToPath(new URL('../', import.meta.url));
const read = rel => readFileSync(path.join(repoDir, rel), 'utf8');

const sandbox = { console, Math, Date, JSON, Object, Array, String, Number, RegExp };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(read('shared/finance-summary.js'), sandbox, { filename: 'finance-summary.js' });
vm.runInContext(read('ai-assistant.js'), sandbox, { filename: 'ai-assistant.js' });

const build = (data) => sandbox.FinancialAIAssistant.prototype._buildFinanceContext.call({}, data);
const fin = sandbox.FTFinance;
const now = fin.currentMonthKey();
const monthsAgo = (n) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - n); return fin.currentMonthKey(d); };

const rowsOf = (ctx) => ctx.split('\n').filter(l => /^\d{4}-\d{2}\|(\d{4}-\d{2}-\d{2})?\|/.test(l));
const summaryLine = (ctx, month) => ctx.split('\n').find(l => l.startsWith(month + '|') && l.split('|').length === 6);

// ── 1. Every row, in date order, whatever order they were entered in ────────
{
    const transactions = [];
    let id = 1;
    // Newest month first, the way demo-data.js builds it.
    for (let back = 0; back < 6; back++) {
        const month = monthsAgo(back);
        transactions.push({ id: id++, type: 'income', desc: 'משכורת', amt: 10000, cat: 'משכורת', month });
        for (let k = 0; k < 15; k++) {
            transactions.push({ id: id++, type: 'expense', desc: `הוצאה ${k}`, amt: 100 + k, cat: k % 2 ? 'מזון' : 'חשבונות', month });
        }
    }
    const ctx = build({ transactions, fixedIncomes: [], fixedExpenses: [] });
    const rows = rowsOf(ctx);

    assert.equal(rows.length, 96, 'all 96 rows, not the last 50');
    assert.ok(ctx.includes('כל 96 העסקאות.'), 'the header says the rows are complete');
    assert.ok(rows.some(r => r.startsWith(now + '|')), 'the current month is in — the old slice left it out');
    const months = rows.map(r => r.slice(0, 7));
    assert.deepEqual(months, [...months].sort(), 'rows are in month order');
}

// ── 2. The month totals are the app's, not a sum of rows ────────────────────
// A fixed salary template plus the imported salary it covers: a plain sum
// counts it twice; monthSummary does not.
{
    const month = now;
    const data = {
        transactions: [
            { id: 1, type: 'income', desc: 'משכורת - חברה', amt: 12000, cat: 'משכורת', month },
            { id: 2, type: 'expense', desc: 'סופר', amt: 3000, cat: 'מזון', month },
            { id: 3, type: 'expense', desc: 'מכולת', amt: 200, cat: 'מזון', month: monthsAgo(2) },
        ],
        fixedIncomes: [{ description: 'משכורת', amount: 12000, category: 'משכורת', start: monthsAgo(3), end: month }],
        fixedExpenses: [{ description: 'משכנתא', amount: 4000, category: 'דיור', start: monthsAgo(3), end: month }],
    };
    const s = fin.monthSummary(data, month);
    const ctx = build(data);
    const line = summaryLine(ctx, month);
    assert.equal(line, [month, s.inc, s.exp, s.bal, Math.round(s.tithe), Math.round(s.available)].join('|'));
    assert.equal(s.inc, 12000, 'sanity: the template is not counted on top of the imported salary');

    // A month between transactions that has only templates still shows them.
    assert.ok(summaryLine(ctx, monthsAgo(1)).startsWith(`${monthsAgo(1)}|12000|4000|8000|`));

    // Category sums are transactions only, and labelled that way.
    assert.ok(ctx.includes('(סכום עסקאות בלבד, ללא הוצאות קבועות)'));
    assert.ok(ctx.includes(`${month}: מזון 3000`));
    assert.ok(!/דיור \d/.test(ctx.split('-- עסקאות --')[0].split('-- הוצאות לפי קטגוריה')[1]),
        'a fixed expense must not appear in the transactions-only category sums');
}

// ── 3. A month with no data at all reads "—" ────────────────────────────────
{
    const ctx = build({
        transactions: [{ id: 1, type: 'expense', desc: 'x', amt: 50, cat: 'מזון', month: monthsAgo(2) }],
        fixedIncomes: [], fixedExpenses: [],
    });
    assert.equal(summaryLine(ctx, monthsAgo(1)), `${monthsAgo(1)}|—|—|—|—|—`);
    assert.ok(summaryLine(ctx, now), 'the range runs up to the current month');
}

// ── 4. Over budget: the oldest rows go, and the model is told ───────────────
{
    const transactions = [];
    const desc = 'ת'.repeat(180);
    for (let i = 0; i < 1500; i++) {
        transactions.push({ id: i, type: 'expense', desc, amt: 10, cat: 'מזון', month: monthsAgo(Math.floor(i / 100)) });
    }
    const ctx = build({ transactions, fixedIncomes: [], fixedExpenses: [] });
    const rows = rowsOf(ctx);
    assert.ok(rows.length < 1500, 'something had to be dropped');
    assert.ok(rows.join('\n').length <= 200000, 'rows stay inside the budget');
    assert.ok(ctx.includes(`${rows.length} מתוך 1500 עסקאות. ${1500 - rows.length} הישנות ביותר הושמטו`),
        'the header says how many are missing');
    assert.equal(rows[rows.length - 1].slice(0, 7), now, 'the newest rows are the ones kept');
    // The totals still cover the dropped months.
    assert.ok(summaryLine(ctx, monthsAgo(14)).startsWith(`${monthsAgo(14)}|0|1000|`));
}

// ── 5. A description cannot break the row format ────────────────────────────
{
    const ctx = build({
        transactions: [{ id: 1, type: 'expense', desc: 'שורה|עם\nשבירה', amt: 5, cat: 'מזון', month: now }],
        fixedIncomes: [], fixedExpenses: [],
    });
    assert.ok(rowsOf(ctx).some(r => r.endsWith('|שורה עם שבירה|')));
}

// ── 6. The question goes out once, and the window opens on a user turn ──────
{
    const history = (messages, q) =>
        sandbox.FinancialAIAssistant.prototype._historyForApi.call({ messages }, q).map(m => `${m.role}:${m.content}`);

    // _handleSend records the question before the call is built.
    assert.deepEqual(history([
        { role: 'user', content: 'א' }, { role: 'assistant', content: 'ב' }, { role: 'user', content: 'ג' },
    ], 'ג'), ['user:א', 'assistant:ב', 'user:ג'], 'the current question must not be sent twice');

    // If it was not recorded, it is still sent.
    assert.deepEqual(history([{ role: 'user', content: 'א' }, { role: 'assistant', content: 'ב' }], 'ג'),
        ['user:א', 'assistant:ב', 'user:ג']);

    // Eleven turns: the ten-turn window would open on an assistant reply.
    const long = [];
    for (let i = 0; i < 6; i++) long.push({ role: 'user', content: `q${i}` }, { role: 'assistant', content: `a${i}` });
    long.push({ role: 'user', content: 'q6' });
    const out = history(long, 'q6');
    assert.equal(out[0].split(':')[0], 'user', 'the window must start on a user turn');
    assert.equal(out[out.length - 1], 'user:q6');
}

console.log('✓ ai finance context: full history, app totals, honest truncation');
