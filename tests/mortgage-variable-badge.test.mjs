// Pins that a prime tranche is shown as "משתנה" (variable) — same as var5/var1 —
// and gets the same "עדכון הריבית הבא" field they do.
//
// Every OTHER place in mortgage.html that asks "is this route variable?" already
// tests `['prime','var5','var1'].includes(t.type)` — the early-repayment penalty,
// the rate-sensitivity chart, the recommendations. renderCurrentTranches() had its
// own copy that forgot prime, so the one card the user opens most called a prime
// route "קבועה" (fixed) and hid the field for scheduling its next rate check —
// even though prime resets whenever Bank Israel moves, same underlying mechanism
// as the other two.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../mortgage.html', import.meta.url), 'utf8');
const grab = (a, b) => {
  const s = html.indexOf(a), e = html.indexOf(b, s);
  if (s < 0 || e < 0) throw new Error(`marker not found: ${a}`);
  return html.slice(s, e);
};

const src = [
  grab('const isValidYM =', '// Single state object'),
  grab('function pmt(r, n, pv)', 'function totalInterest'),
  grab('const TYPE_LABELS', '═══════════════════════════ MATH'),
  grab('function fmtShort', '\nfunction calcSpitzer'),
  grab('function anchorLabel', 'window.toggleTranche'),
  grab('const CHEVRON', 'function renderCurrentTranches'),
  grab('function renderCurrentTranches', 'function addCurrentTranche'),
].join('\n');

const harness = `
let currentTranches = [];
let anchorTranches = [];
const domEl = { innerHTML: '' };
const document = { getElementById: () => domEl };
function setState(ct, at) { currentTranches = ct; anchorTranches = at; }
return { renderCurrentTranches, setState, readHTML: () => domEl.innerHTML };
`;

const { renderCurrentTranches, setState, readHTML } = new Function(src + harness)();

function badgeFor(type) {
  setState([{ id: 1, type, rate: 5.5, principal: 100000, months: 120 }], [{}]);
  renderCurrentTranches();
  const out = readHTML();
  const badge = /route-badge">([^<]+)</.exec(out);
  return { out, badge: badge && badge[1] };
}

let failures = 0;
const ok = (cond, name, got = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  got: ${got}`}`);
  if (!cond) failures++;
};

const prime = badgeFor('prime');
ok(prime.badge === 'משתנה', 'a prime route is badged as variable, not fixed', prime.badge);
ok(prime.out.includes('עדכון הריבית הבא'),
   'a prime route also gets the next-rate-check field, same as var5/var1');

// Regression guard: the two types that already worked must keep working.
const var1 = badgeFor('var1');
ok(var1.badge === 'משתנה', 'var1 stays variable', var1.badge);
ok(var1.out.includes('עדכון הריבית הבא'), 'var1 keeps its next-rate-check field');

const fix = badgeFor('fix');
ok(fix.badge === 'קבועה', 'a fixed route stays fixed', fix.badge);
ok(!fix.out.includes('עדכון הריבית הבא'), 'a fixed route has no next-rate-check field');

const cpi = badgeFor('cpi');
ok(cpi.badge === 'צמודה', 'an indexed route stays indexed', cpi.badge);

if (failures) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}
console.log('✓ mortgage variable badge: prime counts as variable, like var5/var1');
