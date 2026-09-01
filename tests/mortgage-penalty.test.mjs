// Pins the early-repayment fee to a discounted calculation.
//
// The fee used to be `principal × (rate − market) × years × 0.5`, which does not
// discount at all. On a 28-year tranche that overstates the statutory היוון fee by
// several times over: the instalments being compared are decades away, and the ×0.5
// fudge for the declining balance comes nowhere near paying for that.
//
// The figures here are invented; they are round enough to check by hand.
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../mortgage.html', import.meta.url), 'utf8');
const grab = (a, b) => {
  const s = html.indexOf(a), e = html.indexOf(b, s);
  if (s < 0 || e < 0) throw new Error(`marker not found: ${a}`);
  return html.slice(s, e);
};
const { pmt, pvAnnuity } =
  new Function(grab('function pmt(r, n, pv)', 'function totalInterest') +
               '\n; return {pmt, pvAnnuity};')();

let failures = 0;
const ok = (cond, name, got = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  got: ${got}`}`);
  if (!cond) failures++;
};

// What updatePenalty now does for one tranche.
const fee = (p, rate, months, market) =>
  Math.max(0, pvAnnuity(market, months, pmt(rate, months, p)) - p);
// What it used to do.
const oldFee = (p, rate, months, market) =>
  p * Math.max(0, rate - market) / 100 * months / 12 * 0.5;

const P = 400000, RATE = 5.5, N = 336;

// --- the invariant the old formula could not have ---
// pvAnnuity is the inverse of pmt, so a market rate equal to the loan's own rate
// discounts the instalments back to exactly the principal: no gap, no fee.
ok(Math.abs(fee(P, RATE, N, RATE)) < 0.01, 'no fee when the market sits at the loan rate',
   String(fee(P, RATE, N, RATE)));
ok(fee(P, RATE, N, RATE + 1) === 0, 'no fee when the market has risen above it');

// --- discounting always costs the old formula something, and more the longer the term ---
// The old ×0.5 fudge was a fair approximation over five years and drifted well wide of
// the mark over twenty-eight, always in the direction of overcharging.
const market = 4.5;
const ratio = n => fee(P, RATE, n, market) / oldFee(P, RATE, n, market);
ok(ratio(N) < 1, 'the discounted fee is below the linear one', ratio(N).toFixed(3));
ok(ratio(N) < ratio(60), 'and further below it the longer the remaining term',
   `${ratio(N).toFixed(3)} vs ${ratio(60).toFixed(3)}`);

// The fee is the present value of the instalment stream at the market rate, less
// what is owed — checkable independently of the helper being tested.
const i = market / 1200, pay = pmt(RATE, N, P);
const byHand = pay * (1 - Math.pow(1 + i, -N)) / i - P;
ok(Math.abs(fee(P, RATE, N, market) - byHand) < 0.01, 'fee is PV(instalments) − principal',
   String(fee(P, RATE, N, market)));

// --- it still moves the right way ---
ok(fee(P, RATE, N, 4.0) > fee(P, RATE, N, 5.0), 'a wider gap costs more');
ok(fee(P, RATE, 60, market) < fee(P, RATE, N, market), 'a shorter remaining term costs less');
ok(fee(P / 2, RATE, N, market) < fee(P, RATE, N, market), 'a smaller balance costs less');

// --- a 0% tranche can never carry an interest-differential fee ---
ok(fee(3000, 0, 38, market) === 0, 'a 0% tranche is free of the differential fee');

process.exit(failures ? 1 : 0);
