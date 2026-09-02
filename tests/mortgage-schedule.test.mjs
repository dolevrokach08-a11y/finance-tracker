// Pins the meaning of "תשלום ראשון" in the mortgage projection.
//
// The field names the month of the FIRST payment. A loan whose first instalment falls
// in month M and which is looked at in month M+24 has made 25 payments, not 24 — the
// first one counts. Anchoring the roll on M instead of on the month before it lost
// exactly one instalment from every origination-driven tranche, which showed up as a
// balance several hundred shekels too high and a remaining term one month too long.
//
// The figures here are invented. They are chosen so the arithmetic is checkable by
// hand rather than to describe anyone's actual loan.
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../mortgage.html', import.meta.url), 'utf8');
const grab = (a, b) => {
  const s = html.indexOf(a), e = html.indexOf(b, s);
  if (s < 0 || e < 0) throw new Error(`marker not found: ${a}`);
  return html.slice(s, e);
};
const src = grab('const isValidYM =', '// Single state object')
          + grab('function pmt(r, n, pv)', 'function totalInterest')
          + grab('function fmtShort', '\nfunction calcSpitzer');
const { projectTranche, livePayment, pmt } =
  new Function(src + '\n; return {projectTranche, livePayment, pmt};')();

let failures = 0;
const ok = (cond, name, got = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  got: ${got}`}`);
  if (!cond) failures++;
};

// A round loan: 100,000 over 120 months at 6%, first payment 2024-08, charged on the 10th.
const loan = {
  id: 1, type: 'fix', rate: 6, origPrincipal: 100000, origMonths: 120,
  startYM: '2024-08', payDay: 10,
};
const payment = pmt(6, 120, 100000);

// --- the first payment counts ---
// 2024-08 is payment 1, so by 2026-08 (24 months later) 25 have been made.
const y2 = projectTranche(loan, '2026-08', 31);
ok(y2._paidCount === 25, 'first payment counts: 24 months on is 25 payments', String(y2._paidCount));
ok(y2.months === 120 - 25, 'remaining term is 120 - 25', String(y2.months));

// The month of the first payment itself is payment 1, not payment 0.
ok(projectTranche(loan, '2024-08', 31)._paidCount === 1, 'the first-payment month is one payment');
ok(projectTranche(loan, '2024-07', 31)._paidCount === 0, 'the month before it is none');

// --- the balance follows that same count ---
const i = 6 / 1200;
const expected = k => 100000 * Math.pow(1 + i, k) - payment * ((Math.pow(1 + i, k) - 1) / i);
ok(Math.abs(y2.principal - expected(25)) <= 1,
   'balance is the 25-payment balance, not the 24-payment one',
   `${y2.principal} vs ${expected(25).toFixed(2)}`);
ok(Math.abs(y2.principal - expected(24)) > 100,
   'and is clearly distinct from the off-by-one value');

// --- the charge day still gates the current month ---
ok(projectTranche(loan, '2026-09', 3)._paidCount === 25, 'before the 10th, September has not paid');
ok(projectTranche(loan, '2026-09', 10)._paidCount === 26, 'on the 10th it has');

// --- origination is the single source once it is present ---
// A balance left on the record from the older data model must not override it. The
// figure shown on a bank's website is principal plus interest accrued since the charge
// date, so honouring it here made the balance wrong by however many days had passed.
const strayBalance = { ...loan, principal: 90000, asOf: '2026-06' };
ok(Math.abs(projectTranche(strayBalance, '2026-08', 31).principal - expected(25)) <= 1,
   'origination beats a stray balance on the same tranche',
   String(projectTranche(strayBalance, '2026-08', 31).principal));

// --- without origination, a typed balance is still the anchor, dated to its month ---
// The roll then applies exactly the payments after that month, with no extra one.
const typed = { id: 2, type: 'fix', rate: 6, principal: 90000, months: 95, asOf: '2026-06' };
ok(projectTranche(typed, '2026-09', 31)._advanced === 3,
   'a typed balance rolls one payment per month after it, not one more',
   String(projectTranche(typed, '2026-09', 31)._advanced));

// --- the remaining term comes from the loan, not from re-deriving it ---
// nper of a payment that pmt produced lands a hair either side of the exact term. Ceiling
// that turned a hair above into a whole extra month, and two tranches of one loan sharing
// a start date and a 360-month term reported 328 and 329 remaining.
const twin = { ...loan, rate: 5.2, origPrincipal: 420000 };
const other = { ...loan, id: 9, rate: 5.4, origPrincipal: 280000 };
const a = projectTranche(twin, '2026-08', 31), b = projectTranche(other, '2026-08', 31);
ok(a._paidCount === b._paidCount, 'two tranches starting together have paid the same number',
   `${a._paidCount} vs ${b._paidCount}`);
ok(a.months === b.months, 'and have the same term remaining', `${a.months} vs ${b.months}`);
ok(a.months === loan.origMonths - a._paidCount, 'which is the original term less what has been paid',
   `${a.months} vs ${loan.origMonths - a._paidCount}`);

// --- the payment itself is unaffected by any of this ---
ok(Math.abs(livePayment(loan) - payment) < 0.01, 'payment comes from the loan terms');

process.exit(failures ? 1 : 0);
