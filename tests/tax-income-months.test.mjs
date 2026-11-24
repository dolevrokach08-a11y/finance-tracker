// How one earner's payslips become the monthly gross the tax calculation multiplies by 12.
//
// The average used to be taken over the months that have a payslip, so every month without
// one was filled in as if a salary had come in. That is right for a month still ahead and
// wrong for one that passed with no income — the case that raised it: maternity pay that
// arrives in one lump in October and covers November and December, which then have no
// payslip. Ten entries averaged and multiplied by 12 counted those two months twice.
//
// The fix is a "no income" mark for a month, which counts as 0. A passed month with
// neither a payslip nor a mark is still filled in — taking it as 0 would let a payslip
// that was simply never uploaded lower the income and inflate the refund unseen — but it
// is reported in `missingPast` so the screen names it.
//
// earnerYearIncome is read out of the source because the file is a React component tree;
// tools/build-assets.mjs --check keeps the shipped bundle in step with it.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NL = String.fromCharCode(10);
const src = readFileSync(join(ROOT, 'tax-optimizer.src.jsx'), 'utf8').replace(/\r/g, '');

function extract(signature) {
  const from = src.indexOf(signature);
  const to = src.indexOf(NL + '}', from);
  if (from === -1 || to === -1) {
    console.error(`✗ could not find ${signature} in tax-optimizer.src.jsx — this test is checking nothing.`);
    process.exit(1);
  }
  return src.slice(from, to + 2);
}
const constLine = src.split(NL).find(l => l.startsWith('const NO_INCOME_SOURCE'));
if (!constLine) { console.error('✗ NO_INCOME_SOURCE not found'); process.exit(1); }
const { earnerYearIncome, NO_INCOME_SOURCE } = new Function(
  constLine + NL + extract('function earnerYearIncome(') + '; return { earnerYearIncome, NO_INCOME_SOURCE };'
)();

let failed = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `   got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};

const slip = (month, gross, earner = 'mother', extra = {}) => ({ month, gross, net: gross * 0.8, earner, ...extra });
const none = (month, earner = 'mother') => ({ month, gross: 0, net: 0, earner, source: NO_INCOME_SOURCE, fileName: 'ללא הכנסה' });
const months = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => `2026-${String(from + i).padStart(2, '0')}`);

// The case that raised it: Jan–Sep salary 12,000, maternity pay 42,000 entered in October.
const salary = months(1, 9).map(m => slip(m, 12000));
const lump = slip('2026-10', 42000, 'mother', { source: 'manual', fileName: 'הזנה ידנית' });
const actual = 9 * 12000 + 42000; // 150,000

{
  const r = earnerYearIncome([...salary, lump], 'mother', 2026, '2026-11');
  check('without marks: 10 months', r.months, 10);
  check('without marks: annual is overstated (Nov–Dec filled in)', r.avg * 12, 180000);
  check('November is not over yet, so nothing is reported missing', r.missingPast, []);
}
{
  const r = earnerYearIncome([...salary, lump, none('2026-11'), none('2026-12')], 'mother', 2026, '2026-11');
  check('marked Nov–Dec: 12 months', r.months, 12);
  check('marked Nov–Dec: annual equals the real total', r.avg * 12, actual);
  check('marked Nov–Dec: two no-income months', r.noIncome, ['2026-11', '2026-12']);
  check('marked Nov–Dec: payslip count excludes marks', r.count, 10);
}
{
  // Looking back from 2027 without marks: the two months are named, still filled in.
  const r = earnerYearIncome([...salary, lump], 'mother', 2026, '2027-03');
  check('from 2027: Nov–Dec reported missing', r.missingPast, ['2026-11', '2026-12']);
  check('from 2027: still filled in, not silently 0', r.avg * 12, 180000);
}

// A payslip that was never uploaded is not taken as 0.
{
  const slips = months(1, 12).filter(m => m !== '2026-05').map(m => slip(m, 10000));
  const r = earnerYearIncome(slips, 'mother', 2026, '2027-01');
  check('missing May: income still ~120,000', r.avg * 12, 120000);
  check('missing May: named', r.missingPast, ['2026-05']);
}

// Two employers in one month are one month.
{
  const r = earnerYearIncome([slip('2026-01', 8000), slip('2026-01', 4000, 'mother', { fileName: 'b' }), slip('2026-02', 12000)], 'mother', 2026, '2026-03');
  check('two payslips in January: 2 months', r.months, 2);
  check('two payslips in January: average 12,000', r.avg, 12000);
  check('two payslips in January: 3 payslips', r.count, 3);
}

// A mark in a month that also has a payslip changes nothing.
{
  const r = earnerYearIncome([slip('2026-01', 10000), none('2026-01'), slip('2026-02', 10000)], 'mother', 2026, '2026-03');
  check('mark over a payslip: average unchanged', r.avg, 10000);
  check('mark over a payslip: not counted as no-income', r.noIncome, []);
}

// Marks alone say nothing about the salary: no average, so the slider is left alone.
{
  const r = earnerYearIncome([none('2026-11'), none('2026-12')], 'mother', 2026, '2026-11');
  check('marks only: no average', r.avg, null);
}

// Other earner and other years are ignored.
{
  const r = earnerYearIncome([slip('2026-01', 10000, 'father'), slip('2025-12', 99999), slip('2026-01', 7000)], 'mother', 2026, '2026-02');
  check('only this earner and year', [r.avg, r.months], [7000, 1]);
}

// Nothing at all.
check('no payslips', earnerYearIncome([], 'mother', 2026, '2026-11').avg, null);
// (the function still lists the passed months; the screen shows them only when there is an average)
check('no payslips: passed months listed', earnerYearIncome([], 'mother', 2026, '2026-11').missingPast.length, 10);

if (failed) {
  console.error(`\n✗ ${failed} failed`);
  process.exit(1);
}
console.log('\n✓ all passed');
