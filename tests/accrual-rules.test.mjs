// Which month a row belongs to on accrual basis, once a merchant rule can decide it.
//
// Two flags move a row one month: an income's "stays in the month received" and an
// expense's "billed in arrears". They used to be ticked row by row, and a missed tick bent
// the accrual charts with nothing on screen to say so. shared/accrual-rules.js lets a rule
// carry the tick for a merchant. This file checks two things separately:
//
//   1. the module's own logic — matching, precedence, what a rule would move;
//   2. the wiring — finance.html's computeAssignedMonth, read out of the page itself, so a
//      test that passes here is about the function the reports actually call.
//
// The baseline cases (no rules) are the ones that must not have moved at all.

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
vm.runInThisContext(readFileSync(join(ROOT, 'shared/accrual-rules.js'), 'utf8'));
const A = globalThis.FTAccrual;

let failed = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};

// ── finance.html's own functions ───────────────────────────────────────────────
const html = readFileSync(join(ROOT, 'finance.html'), 'utf8').replace(/\r\n/g, '\n');
function extract(name) {
  const from = html.indexOf(`        function ${name}(`);
  const to = html.indexOf('\n        }\n', from);
  if (from === -1 || to === -1) {
    console.error(`✗ could not find ${name} in finance.html — this test is checking nothing.`);
    process.exit(1);
  }
  return html.slice(from, to + 11);
}
// Extracting single functions proves nothing about the page around them: a stray line
// between two functions once left the whole page dead while every case below passed.
// So first, every inline script has to parse — the page's main one is a module, which
// vm.Script cannot read, so each goes through `node --check` as .mjs or .js.
{
  const dir = mkdtempSync(join(tmpdir(), 'ft-parse-'));
  let n = 0, parsed = 0;
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)) {
    const file = join(dir, `s${n++}${/type="module"/.test(m[1]) ? '.mjs' : '.js'}`);
    writeFileSync(file, m[2]);
    const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (r.status === 0) { parsed++; continue; }
    failed++;
    console.log(`✗ finance.html inline script #${n} does not parse:\n${(r.stderr || '').split('\n').slice(0, 5).join('\n')}`);
  }
  rmSync(dir, { recursive: true, force: true });
  if (!n) { failed++; console.log('✗ no inline scripts found in finance.html'); }
  else if (parsed === n) console.log(`✓ all ${n} inline scripts in finance.html parse`);
}

const boundary = html.match(/const LEGACY_BOUNDARY = '(\d{4}-\d{2})';/);
if (!boundary) { console.error('✗ LEGACY_BOUNDARY not found in finance.html'); process.exit(1); }

const page = new Function('window', 'data', `
  const LEGACY_BOUNDARY = '${boundary[1]}';
  ${['monthMinusOne', 'monthPlusOne', 'monthFromDate', 'accrualCtx', 'accrualFlag', 'computeAssignedMonth'].map(extract).join('\n')}
  return { computeAssignedMonth, legacy: LEGACY_BOUNDARY };
`);
const monthOf = (tx, d = {}) =>
  page({ FTAccrual: A }, { transactions: [], fixedIncomes: [], accrualRules: [], ...d }).computeAssignedMonth(tx);

// ── 1. Nothing moved for a page without rules ─────────────────────────────────
const exp = (desc, date, month, extra = {}) => ({ type: 'expense', desc, amt: 100, transactionDate: date, month, ...extra });
const inc = (desc, month, extra = {}) => ({ type: 'income', desc, amt: 100, month, ...extra });

check('expense, no rule → calendar month of its date', monthOf(exp('סופר', '2026-08-15', '2026-09')), '2026-08');
check('expense ticked in arrears → one back', monthOf(exp('סופר', '2026-08-15', '2026-09', { assignToPreviousMonth: true })), '2026-07');
check('income, no rule → one back (salary = month worked)', monthOf(inc('משכורת', '2026-09')), '2026-08');
check('income ticked → month received', monthOf(inc('משכורת', '2026-09', { assignToCurrentMonth: true })), '2026-09');

// ── 2. A rule carries the tick ────────────────────────────────────────────────
const nursery = { id: 1, type: 'expense', keyword: 'פעוטון' };
const allowance = { id: 2, type: 'income', keyword: 'ביטוח לאומי' };
const rules = { accrualRules: [nursery, allowance] };

check('rule: nursery with a terminal id → in arrears', monthOf(exp('פעוטון הדקל 123456', '2026-08-15', '2026-09'), rules), '2026-07');
check('rule: row says false → opts out', monthOf(exp('פעוטון הדקל', '2026-08-15', '2026-09', { assignToPreviousMonth: false }), rules), '2026-08');
check('rule: income rule → month received', monthOf(inc('ביטוח לאומי קצבת ילדים', '2026-09'), rules), '2026-09');
check('rule: type-bound — expense rule does not touch an income', monthOf(inc('החזר פעוטון', '2026-09'), rules), '2026-08');
check('rule: unrelated expense untouched', monthOf(exp('סופר', '2026-08-15', '2026-09'), rules), '2026-08');

// Legacy aggregates are already one month back; a rule must not push them a second time.
const legacyMonth = page({ FTAccrual: A }, {}).legacy;
check('rule: legacy aggregate row not shifted twice',
  monthOf({ type: 'expense', desc: 'פעוטון', amt: 100, month: legacyMonth }, rules),
  (() => { const [y, m] = legacyMonth.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; })());

// ── 3. The fixed-income template path, moved here unchanged ───────────────────
const tmpl = { fixedIncomes: [{ description: 'שכר דירה', assignToCurrentMonth: true, start: '2026-05', end: '2026-12' }] };
check('template: in range → month received', monthOf(inc('שכר דירה', '2026-09'), tmpl), '2026-09');
check('template: before its start → default shift', monthOf(inc('שכר דירה', '2026-04'), tmpl), '2026-03');
check('template: row says false → opts out', monthOf(inc('שכר דירה', '2026-09', { assignToCurrentMonth: false }), tmpl), '2026-08');

// ── 4. What gets stored for a checkbox ────────────────────────────────────────
const ctx = { rules: [nursery], fixedIncomes: [], legacyBoundary: legacyMonth };
const row = exp('פעוטון הדקל', '2026-08-15', '2026-09');
check('store: ticked and the rule agrees → nothing stored', A.explicitFor(true, row, ctx), undefined);
check('store: unticked against the rule → false', A.explicitFor(false, row, ctx), false);
check('store: ticked, no rule → true', A.explicitFor(true, exp('חשמל', '2026-08-15', '2026-09'), ctx), true);
check('store: unticked, no rule → nothing stored', A.explicitFor(false, exp('חשמל', '2026-08-15', '2026-09'), ctx), undefined);
check('store: a stale true on the row is ignored when deciding', A.explicitFor(false, { ...row, assignToPreviousMonth: true }, ctx), false);

// ── 5. What a rule would move, and what it suggests ───────────────────────────
const txs = [
  exp('גן הדקל 1111', '2026-05-15', '2026-06', { assignToPreviousMonth: true }),
  exp('גן הדקל 2222', '2026-06-15', '2026-07', { assignToPreviousMonth: true }),
  exp('גן הדקל 3333', '2026-07-15', '2026-08'),                                  // missed
  exp('גן הדקל 4444', '2026-08-15', '2026-09'),                                  // missed
  exp('גן הדקל 5555', '2026-09-02', '2026-09', { assignToPreviousMonth: false }), // opted out
  exp('חשמל', '2026-08-15', '2026-09', { assignToPreviousMonth: true }),         // once only
  exp('סופר', '2026-08-15', '2026-09'),
];
const noRules = { rules: [], fixedIncomes: [], legacyBoundary: legacyMonth };
const garden = { id: 9, type: 'expense', keyword: 'גן הדקל' };
check('impact: only the two missed rows move', A.ruleImpact(garden, txs, noRules).map(m => m.tx.desc), ['גן הדקל 3333', 'גן הדקל 4444']);
check('impact: removal moves the same two back',
  A.removalImpact(9, txs, { ...noRules, rules: [garden] }).map(m => [m.tx.desc, m.after]),
  [['גן הדקל 3333', false], ['גן הדקל 4444', false]]);

const sugg = A.suggestRules(txs, noRules);
check('suggest: one merchant, terminal ids merged', sugg.map(s => s.keyword), ['גן הדקל']);
check('suggest: counts', sugg.map(s => [s.total, s.flagged, s.optedOut, s.moves.length]), [[5, 2, 1, 2]]);
check('suggest: flagged once is not enough', A.suggestRules(txs, noRules).some(s => s.keyword === 'חשמל'), false);
check('suggest: nothing once the rule exists', A.suggestRules(txs, { ...noRules, rules: [garden] }), []);

// ── 6. Matching ───────────────────────────────────────────────────────────────
check('normalize: short numbers are part of the name', A.normalizeMerchant('7 אחים'), '7 אחים');
check('normalize: terminal ids and spacing go', A.normalizeMerchant('  שופרסל   דיל 004512 '), 'שופרסל דיל');
check('match: whole words — "מים" is not in "פעמים"', !!A.ruleFor({ type: 'expense', desc: 'פעמים בשבוע' }, [{ type: 'expense', keyword: 'מים' }]), false);
check('match: whole words — "מים" is in "תאגיד מים 4521"', !!A.ruleFor({ type: 'expense', desc: 'תאגיד מים 4521' }, [{ type: 'expense', keyword: 'מים' }]), true);
check('normalize: punctuation is a word break', A.normalizeMerchant('סופר ירוק - קניות'), 'סופר ירוק קניות');
check('match: case-insensitive', !!A.ruleFor({ type: 'expense', desc: 'NETFLIX.COM' }, [{ type: 'expense', keyword: 'netflix' }]), true);

console.log(failed ? `\n✗ ${failed} failed` : '\n✓ all passed');
process.exit(failed ? 1 : 0);
