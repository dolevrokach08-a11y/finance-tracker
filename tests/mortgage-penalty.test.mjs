// Pins the early-repayment fee to the two-alternative rule in the 2002 order.
//
// The fee is not one interest-gap calculation. It is the SMALLER of two:
//
//   fee3 = PV(A) - PV(R)   against the tranche's own contract rate
//   fee4 = PV(A) - PV(C)   against the average rate in force when it was taken out
//
// Only fee3 was implemented at first, and no market rate exists that makes fee3 land
// on the bank's figure for two tranches of one mortgage at once — the second
// alternative is what binds in practice. A fee that quietly drops the cap comes out
// roughly double, so the cap is what these tests mostly guard.
//
// Rates here are effective annual, as the order has them; the contract rate is stored
// nominal elsewhere in the file and converted by effAnnual before use.
//
// The figures are invented. They are round enough to check by hand.
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../mortgage.html', import.meta.url), 'utf8');
const grab = (a, b) => {
  const s = html.indexOf(a), e = html.indexOf(b, s);
  if (s < 0 || e < 0) throw new Error(`marker not found: ${a}`);
  return html.slice(s, e);
};
const src = grab('function pmt(r, n, pv)', 'function totalInterest')
          + grab('function effAnnual(nominal)', 'function renderPenaltyPage');
const { pmt, effAnnual, pvFlows, penaltyFlows, accruedSinceCharge, seniorityDiscount } =
  new Function(src + '\n; return {pmt, effAnnual, pvFlows, penaltyFlows, accruedSinceCharge, seniorityDiscount};')();

let failures = 0;
const ok = (cond, name, got = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  got: ${got}`}`);
  if (!cond) failures++;
};
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

// What updatePenalty computes for one tranche.
const fee = (p, rate, months, A, C, resetIn = 0) => {
  const flows = penaltyFlows(p, rate, months, resetIn);
  const pvA = pvFlows(A, flows);
  const fee3 = pvA - pvFlows(effAnnual(rate), flows);
  const fee4 = C > 0 ? pvA - pvFlows(C, flows) : null;
  return { fee3, fee4, taken: Math.max(0, fee4 === null ? fee3 : Math.min(fee3, fee4)) };
};

const P = 400000, RATE = 5.5, N = 336;

// --- the convention that makes the whole thing hang together ---
// A nominal 5.5% is an effective 5.6408%. Discounting the instalments at that rate
// returns exactly the principal, so an average rate equal to the loan's own rate
// produces exactly zero rather than a rounding artefact.
ok(near(effAnnual(5.5), 5.640786, 0.0001), 'nominal 5.5% is effective 5.6408%',
   effAnnual(5.5).toFixed(6));
ok(near(pvFlows(effAnnual(RATE), penaltyFlows(P, RATE, N, 0)), P, 0.01),
   'discounting a loan at its own rate returns the principal',
   pvFlows(effAnnual(RATE), penaltyFlows(P, RATE, N, 0)).toFixed(2));
ok(fee(P, RATE, N, effAnnual(RATE), 0).taken === 0, 'no fee when the average sits at the loan rate');
ok(fee(P, RATE, N, 7, 0).taken === 0, 'no fee when the average has risen above it');

// --- the cap is what binds, and it is the point of this round ---
// A loan taken out when the average was 5.2%, looked at when the average is 4.4%.
const capped = fee(P, RATE, N, 4.4, 5.2);
ok(capped.fee4 < capped.fee3, 'the origination alternative is the smaller one',
   `${capped.fee4.toFixed(0)} vs ${capped.fee3.toFixed(0)}`);
ok(near(capped.taken, capped.fee4), 'and it is the one charged');
ok(capped.fee3 > capped.fee4 * 1.4,
   'dropping the cap would overstate the fee by nearly half again',
   `${capped.fee3.toFixed(0)} vs ${capped.fee4.toFixed(0)}`);

// The cap can also fall away, but only one way round: fee3 is the smaller of the two
// exactly when the average AT ORIGINATION was above the rate this borrower actually
// got — someone who signed a better-than-average deal is compared to their contract.
const uncapped = fee(P, RATE, N, 4.4, 6.5);
ok(near(uncapped.taken, uncapped.fee3), 'the contract alternative wins when it is smaller',
   `${uncapped.fee3.toFixed(0)} vs ${uncapped.fee4.toFixed(0)}`);

// A rise since origination cannot produce a fee, whatever the contract rate says.
ok(fee(P, RATE, N, 5.9, 4.9).taken === 0, 'no fee when the average rose since origination');

// --- a variable tranche is discounted only to its next reset ---
const RESET = 34;
const flows = penaltyFlows(P, RATE, N, RESET);
ok(flows.length === RESET, 'the cashflow stops at the reset', String(flows.length));
const pay = pmt(RATE, N, P), mr = RATE / 1200;
const balloon = P * Math.pow(1 + mr, RESET) - pay * ((Math.pow(1 + mr, RESET) - 1) / mr);
ok(near(flows[RESET - 1][1], pay + balloon, 0.01),
   'and carries the balance still owed there as a final payment',
   String(flows[RESET - 1][1]));
ok(fee(P, RATE, N, 4.4, 5.2, RESET).taken < capped.taken,
   'a reset in three years costs less than exposure to the full term',
   `${fee(P, RATE, N, 4.4, 5.2, RESET).taken.toFixed(0)} vs ${capped.taken.toFixed(0)}`);
// A reset beyond the end of the loan is not a reset.
ok(penaltyFlows(P, RATE, N, N + 12).length === N, 'a reset past the end is ignored');

// --- it still moves the right way ---
ok(fee(P, RATE, N, 4.0, 5.2).taken > fee(P, RATE, N, 5.0, 5.2).taken, 'a wider gap costs more');
ok(fee(P, RATE, 60, 4.4, 5.2).taken < capped.taken, 'a shorter remaining term costs less');
ok(fee(P / 2, RATE, N, 4.4, 5.2).taken < capped.taken, 'a smaller balance costs less');
ok(fee(3000, 0, 38, 4.4, 5.2).taken === 0, 'a 0% tranche carries no fee at all');

// --- accrued interest, on the actual/365 basis the bank's own statements confirm ---
// The notice fee is a tenth of a percent of principal PLUS this, not of principal alone.
// Anchored to today's date so the test does not need to stub the clock.
const today = new Date().getDate();
if (today <= 28) {
  ok(accruedSinceCharge(P, RATE, today) === 0, 'nothing has accrued on the charge day itself',
     String(accruedSinceCharge(P, RATE, today)));
}
const dayAfter = today >= 28 ? 1 : today + 1;   // charge day just missed: a full month accrued
const month = accruedSinceCharge(P, RATE, dayAfter);
ok(month > P * RATE / 100 * 27 / 365 && month < P * RATE / 100 * 32 / 365,
   'a whole month back is about a month of interest', month.toFixed(2));
ok(near(accruedSinceCharge(P * 2, RATE, dayAfter), month * 2, 0.01), 'it scales with the balance');
ok(near(accruedSinceCharge(P, RATE * 2, dayAfter), month * 2, 0.01), 'and with the rate');
ok(accruedSinceCharge(P, 0, dayAfter) === 0, 'a 0% tranche accrues nothing');

// --- the seniority reduction in section 8(b), verified against the order itself ---
// Two tiers, applied to the fee AFTER the alternative is chosen. The tranche's age is
// only known when it has origination terms; without them nothing is deducted.
ok(seniorityDiscount(null) === 0, 'an unknown age deducts nothing');
ok(seniorityDiscount(0) === 0 && seniorityDiscount(35) === 0, 'under three years, nothing');
ok(seniorityDiscount(36) === 0.2 && seniorityDiscount(59) === 0.2, 'three to five years, a fifth');
ok(seniorityDiscount(60) === 0.3 && seniorityDiscount(400) === 0.3, 'five years and up, three tenths');
// The boundaries are the point: an off-by-one here silently changes a fee by a fifth.
ok(seniorityDiscount(35) !== seniorityDiscount(36), 'the first tier starts at exactly 36 months');
ok(seniorityDiscount(59) !== seniorityDiscount(60), 'the second at exactly 60');

// It scales the chosen alternative, not the gross of one of them.
const net = capped.taken * (1 - seniorityDiscount(48));
ok(near(net, capped.taken * 0.8), 'a four-year-old tranche pays four fifths of its fee',
   net.toFixed(2));

// 8(a), the supplementary-loan ladder, is deliberately absent: nothing in the data
// classifies a loan as one, and guessing in the borrower's favour understates.
ok(seniorityDiscount(12) === 0 && seniorityDiscount(24) === 0,
   'the supplementary ladder is not applied at one or two years');

process.exit(failures ? 1 : 0);
