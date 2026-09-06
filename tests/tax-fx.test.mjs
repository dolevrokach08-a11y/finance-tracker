// Where today's exchange rate comes from, and what happens when there isn't one.
//
// The rate scales every shekel figure on the tax screen, so a wrong one moves the whole
// comparison — and nothing on screen distinguishes a real rate from an invented one. The
// code used to fall back to a hardcoded 3.6 for the dollar and 3.9 for everything else.
// 3.9 was never a rate for anything: it was roughly the euro once, applied to any currency
// that was not the dollar. By the time this test was written the dollar sat near 3.03, so
// the dollar fallback alone was about 19% out.
//
// currentFX is read out of the source rather than imported, because the file is a React
// component tree. tools/build-assets.mjs --check keeps the shipped bundle in step with it.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NL = String.fromCharCode(10);
const src = readFileSync(join(ROOT, 'tax-optimizer.src.jsx'), 'utf8');

const from = src.indexOf('function currentFX(');
const to = src.indexOf(NL + '}', from);
if (from === -1 || to === -1) {
  console.error('✗ could not find currentFX in tax-optimizer.src.jsx — this test is checking nothing.');
  process.exit(1);
}
const currentFX = new Function(src.slice(from, to + 2) + '; return currentFX;')();

let failed = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `   got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};

const fxMap = new Map([
  ['2026-03', { USD: 3.1126, EUR: 3.5985 }],
  ['2026-04', { USD: 3.0305, EUR: 3.5509 }],
]);

check('shekels are not converted', currentFX('ILS', {}, fxMap), { rate: 1, source: 'ils' });
check('no currency at all is treated as shekels', currentFX(undefined, {}, fxMap), { rate: 1, source: 'ils' });

check('a live rate is used and named as live',
  currentFX('USD', { USD: 3.05 }, fxMap), { rate: 3.05, source: 'live' });

// The whole point: with no live rate the answer is a real dated number, and it says which.
check('without a live rate, the newest month in the series is used',
  currentFX('USD', {}, fxMap), { rate: 3.0305, source: '2026-04' });
check('and for the euro too',
  currentFX('EUR', null, fxMap), { rate: 3.5509, source: '2026-04' });

check('a zero live rate is not a rate', currentFX('USD', { USD: 0 }, fxMap), { rate: 3.0305, source: '2026-04' });
check('nor is a non-numeric one', currentFX('USD', { USD: 'n/a' }, fxMap), { rate: 3.0305, source: '2026-04' });

// The old code answered 3.9 here — a number with no basis, for a currency it had never seen.
check('a currency the series does not carry gets no rate at all',
  currentFX('GBP', {}, fxMap), { rate: null, source: null });
check('and neither does one with no series to consult',
  currentFX('USD', {}, new Map()), { rate: null, source: null });
check('nor with no series object at all',
  currentFX('USD', undefined, undefined), { rate: null, source: null });

// A guard against the fallback creeping back in under any input.
for (const [cur, rates] of [['GBP', {}], ['CHF', null], ['JPY', { EUR: 3.5 }]]) {
  const { rate } = currentFX(cur, rates, fxMap);
  check(`${cur} is never quietly priced at 3.6 or 3.9`, rate === 3.6 || rate === 3.9, false);
}

console.log(failed ? `${NL}✗ ${failed} failed` : `${NL}✓ tax FX source: all checks passed`);
process.exit(failed ? 1 : 0);
