// Return by allocation group — shared/group-returns.js.
//
// Expected values were written before the first run, from closed forms, not from
// the module's own output:
//
//   One purchase, one closing value, d days apart: XIRR has the closed form
//     r = (V / P) ^ (365.25 / d) − 1          (same 365.25 day count as the page)
//   2025-01-01 → 2026-01-01 is 365 days. P = 1000, V = 1100:
//     r = 1.1 ^ (365.25 / 365) − 1 = 10.00713…%
//
//   Pre-tax sale proceeds:
//     ILS: gross 1200, commission 10, tax 50 (amount 1140)  → 1190
//     USD, recorded, tax in ILS: gross $400, original_amount 400, amount ₪1480
//       → rate 3.7, proceeds ₪1480
//     USD, recorded, tax in USD: gross $400, commission $2, tax $20,
//       original_amount 378, amount ₪1398.6 → rate 3.7, proceeds 398 × 3.7 = ₪1472.6
//
// The rest are behaviours, each stated in its label.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(ROOT, p), 'utf8');
vm.runInThisContext(read('shared/splits.js'));
vm.runInThisContext(read('shared/group-returns.js'));
const G = globalThis.FTGroupReturns;

let failed = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};
const near = (label, got, want, eps = 1e-6) => {
  const ok = typeof got === 'number' && Math.abs(got - want) <= eps;
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : `  — got ${got}, want ${want}`}`);
};

const NOW = new Date('2026-01-01T10:00:00Z');
const groups = [
  { id: 1, name: 'עולמי', color: '#000' },
  { id: 2, name: 'SCV', color: '#111' },
];
const ils = (id, symbol, groupId, shares) => ({ id, symbol, groupId, shares, currency: 'ILS' });
const buy = (assetId, symbol, date, shares, price, extra = {}) => ({
  date, symbol, assetId, shares, price, currency: 'ILS', amount: shares * price, assetType: 'stocks', ...extra,
});
const valueTable = t => h => t[h.symbol];
const byId = (res, id) => res.groups.find(g => g.id === id);

// ---------------------------------------------------------------- XIRR

{
  const r = G.xirr([
    { t: Date.parse('2025-01-01'), v: -1000 },
    { t: Date.parse('2026-01-01'), v: 1100 },
  ]);
  near('xirr: two flows match the closed form', r * 100, (Math.pow(1.1, 365.25 / 365) - 1) * 100, 1e-8);

  // Several flows: whatever rate comes back must zero the NPV.
  const flows = [
    { t: Date.parse('2024-03-01'), v: -5000 },
    { t: Date.parse('2024-09-15'), v: -3000 },
    { t: Date.parse('2025-02-10'), v: 1200 },
    { t: Date.parse('2025-06-30'), v: -2000 },
    { t: Date.parse('2026-01-01'), v: 11000 },
  ];
  const r2 = G.xirr(flows);
  const npv = flows.reduce((s, f) => s + f.v / Math.pow(1 + r2, (f.t - flows[0].t) / 864e5 / 365.25), 0);
  near('xirr: several flows — NPV at the result is zero', npv, 0, 1e-6);
  check('xirr: only outflows has no rate', G.xirr([{ t: 0, v: -1 }, { t: 864e5, v: -1 }]), null);

  // A loss steep enough that Newton from 10% overshoots: 1000 → 50 in one year.
  const r3 = G.xirr([{ t: Date.parse('2025-01-01'), v: -1000 }, { t: Date.parse('2026-01-01'), v: 50 }]);
  near('xirr: deep loss still solves', r3 * 100, (Math.pow(0.05, 365.25 / 365) - 1) * 100, 1e-6);
}

// ------------------------------------------------- one group, closed form

{
  const res = G.build({
    groups, now: NOW,
    holdings: [ils(11, 'AAA', 1, 10)],
    purchases: [buy(11, 'AAA', '2025-01-01T12:00:00.000Z', 10, 100)],
    valueOf: valueTable({ AAA: 1100 }),
  });
  const g = byId(res, 1);
  check('single buy: status ok', g.status, 'ok');
  near('single buy: MWR = closed form', g.mwrPct, (Math.pow(1.1, 365.25 / 365) - 1) * 100, 1e-8);
  check('single buy: invested / value / gain', [g.investedILS, g.valueILS, g.gainILS], [1000, 1100, 100]);
  check('empty group is reported empty, not zero', byId(res, 2).status, 'empty');
  check('empty group has no MWR', byId(res, 2).mwrPct, null);
}

// ------------------------------------------------------------ coverage

{
  const res = G.build({
    groups, now: NOW,
    holdings: [ils(11, 'AAA', 1, 15)],
    purchases: [buy(11, 'AAA', '2025-01-01T12:00:00.000Z', 10, 100)],
    valueOf: valueTable({ AAA: 1650 }),
  });
  const g = byId(res, 1);
  check('units above history: incomplete', g.status, 'incomplete');
  check('units above history: no MWR', g.mwrPct, null);
  check('units above history: reason names the holding',
    g.issues.map(i => [i.reason, i.symbol, i.shares, i.historyShares]), [['coverage', 'AAA', 15, 10]]);
}

{
  // 45 bought, split 3 → 1 on 2025-06-02: 15 units today is complete history.
  const res = G.build({
    groups, now: NOW,
    holdings: [{ id: 11, symbol: 'ETHA', groupId: 1, shares: 15, currency: 'ILS' }],
    purchases: [buy(11, 'ETHA', '2025-01-01T12:00:00.000Z', 45, 20)],
    splits: [{ id: 's1', symbol: 'ETHA', assetId: 11, date: '2025-06-02', tz: 'America/New_York', from: 3, to: 1 }],
    valueOf: valueTable({ ETHA: 990 }),
  });
  check('split: history in today\'s units has no gap', byId(res, 1).status, 'ok');
}

// ----------------------------------------------------- reading amounts

{
  const R = G._read;
  check('ILS sale: pre-tax = gross − commission',
    R.saleILS({ currency: 'ILS', shares: 10, original_price: 120, gross_amount: 1200, commission: 10, tax: 50, amount: 1140, original_amount: 1140 }).ils, 1190);
  near('USD sale, tax in ILS: implied rate 3.7',
    R.saleILS({ currency: 'USD', shares: 4, original_price: 100, gross_amount: 400, commission: 0, tax: 100, taxCurrency: 'ILS', original_amount: 400, amount: 1480 }).ils, 1480, 1e-9);
  near('USD sale, tax in USD: tax added back at the implied rate',
    R.saleILS({ currency: 'USD', shares: 4, original_price: 100, gross_amount: 400, commission: 2, tax: 20, taxCurrency: 'USD', original_amount: 378, amount: 1398.6 }).ils, 1472.6, 1e-9);

  check('recorded USD purchase: amount is already ILS',
    R.purchaseILS({ currency: 'USD', original_currency: 'USD', shares: 10, original_price: 50, fee: 1, original_amount: 500, originalAmount: 501, amount: 1853.7 }, null).ils, 1853.7);
  check('old USD purchase, native amount, no rate: fx issue',
    R.purchaseILS({ currency: 'USD', shares: 30, price: 98.5, amount: 2955, date: '2025-03-15T12:00:00.000Z' }, null),
    { issue: 'fx', currency: 'USD', day: '2025-03-15' });
  check('old USD purchase, native amount, with rate',
    R.purchaseILS({ currency: 'USD', shares: 30, price: 98.5, amount: 2955, date: '2025-03-15T12:00:00.000Z' }, () => 3.6).ils, 2955 * 3.6);
  check('old USD purchase, amount 3.6× native: read as ILS',
    R.purchaseILS({ currency: 'USD', shares: 10, price: 100, amount: 3600 }, () => 9).ils, 3600);
  check('old USD purchase, amount 1.5× native: ambiguous',
    R.purchaseILS({ currency: 'USD', shares: 10, price: 100, amount: 1500 }, () => 3.6), { issue: 'ambiguous' });
  check('USD dividend at the pay-date rate',
    R.dividendILS({ currency: 'USD', amount: 10, payDate: '2025-07-01' }, (c, d) => (c === 'USD' && d === '2025-07-01' ? 3.6 : null)).ils, 36);
}

// ------------------------------------------ fx gaps surface, and dedupe

{
  const usdBuy = (date) => ({ date, symbol: 'VT', shares: 1, price: 100, currency: 'USD', amount: 100, assetType: 'stocks' });
  const res = G.build({
    groups, now: NOW,
    holdings: [{ id: 21, symbol: 'VT', groupId: 2, shares: 2, currency: 'USD' }],
    purchases: [usdBuy('2025-02-01T12:00:00.000Z'), usdBuy('2025-02-01T12:00:00.000Z')],
    valueOf: valueTable({ VT: 800 }),
  });
  check('missing rate: group incomplete', byId(res, 2).status, 'incomplete');
  check('missing rate: asked for once per currency and day', res.needsRates, [{ currency: 'USD', day: '2025-02-01' }]);

  const ok = G.build({
    groups, now: NOW,
    holdings: [{ id: 21, symbol: 'VT', groupId: 2, shares: 2, currency: 'USD' }],
    purchases: [usdBuy('2025-02-01T12:00:00.000Z'), usdBuy('2025-02-01T12:00:00.000Z')],
    valueOf: valueTable({ VT: 800 }),
    rateFor: () => 3.5,
  });
  check('rate supplied: invested 2 × $100 × 3.5', byId(ok, 2).investedILS, 700);
  check('rate supplied: ok', byId(ok, 2).status, 'ok');
}

// ------------------------------------------------ groups follow the UI

{
  const base = {
    now: NOW,
    holdings: [ils(11, 'AAA', 1, 10), ils(12, 'BBB', 2, 5)],
    purchases: [buy(11, 'AAA', '2025-01-01T12:00:00.000Z', 10, 100), buy(12, 'BBB', '2025-01-01T12:00:00.000Z', 5, 100)],
    valueOf: valueTable({ AAA: 1100, BBB: 450 }),
  };
  const onlyFirst = G.build({ ...base, groups: [groups[0]] });
  check('group deleted: its holding is unassigned, not merged',
    onlyFirst.unassigned.filter(u => u.kind === 'holding').map(u => [u.symbol, u.reason]), [['BBB', 'no-group']]);
  check('group deleted: remaining group unchanged', onlyFirst.groups.map(g => [g.id, g.investedILS]), [[1, 1000]]);

  const added = G.build({ ...base, groups: [...groups, { id: 3, name: 'חדש' }] });
  check('group added: appears, empty', added.groups.map(g => [g.id, g.status]), [[1, 'ok'], [2, 'ok'], [3, 'empty']]);

  const moved = G.build({ ...base, groups, holdings: [ils(11, 'AAA', 2, 10), ils(12, 'BBB', 2, 5)] });
  check('holding moved: whole history goes with it', [byId(moved, 1).status, byId(moved, 2).investedILS], ['empty', 1500]);
}

// --------------------------------------------- what is not in any group

{
  const res = G.build({
    groups, now: NOW,
    holdings: [ils(11, 'AAA', 1, 10)],
    purchases: [
      buy(11, 'AAA', '2025-01-01T12:00:00.000Z', 10, 100),
      buy(99, 'GONE', '2025-01-01T12:00:00.000Z', 3, 100),
      { date: '2025-01-01T12:00:00.000Z', symbol: 'BOND', assetId: 77, amount: 5000, assetType: 'bonds' },
    ],
    sales: [{ ...buy(99, 'GONE', '2025-06-01T12:00:00.000Z', 3, 110), gross_amount: 330 }],
    valueOf: valueTable({ AAA: 1100 }),
  });
  check('sold-out holding: its trades are unassigned',
    res.unassigned.map(u => [u.kind, u.symbol, u.reason]), [['purchase', 'GONE', 'no-holding'], ['sale', 'GONE', 'no-holding']]);
  check('bond trades: ignored, not counted in a group', byId(res, 1).investedILS, 1000);
}

{
  const res = G.build({
    groups, now: NOW,
    holdings: [ils(11, 'AAA', 1, 10)],
    purchases: [buy(11, 'AAA', '2026-01-01T09:00:00.000Z', 10, 100)],
    valueOf: valueTable({ AAA: 1000 }),
  });
  check('bought today: too short for a rate', [byId(res, 1).status, byId(res, 1).mwrPct], ['too-short', null]);
}

// ------------------------------------------------- sale and dividend flow

{
  // Buy 10 @100 on 2025-01-01; sell 5 for ₪600 pre-tax on 2025-07-02 (182 days);
  // dividend ₪20 on 2025-07-02; 5 left worth ₪650 on 2026-01-01.
  const res = G.build({
    groups, now: NOW,
    holdings: [ils(11, 'AAA', 1, 5)],
    purchases: [buy(11, 'AAA', '2025-01-01T12:00:00.000Z', 10, 100)],
    sales: [{ date: '2025-07-02T12:00:00.000Z', symbol: 'AAA', assetId: 11, shares: 5, original_price: 120,
      gross_amount: 600, commission: 0, tax: 25, amount: 575, original_amount: 575, currency: 'ILS', assetType: 'stocks' }],
    dividends: [{ symbol: 'AAA', amount: 20, currency: 'ILS', payDate: '2025-07-02' }],
    valueOf: valueTable({ AAA: 650 }),
  });
  const g = byId(res, 1);
  check('sale + dividend: returned = 600 + 20', g.returnedILS, 620);
  check('sale + dividend: gain = 650 + 620 − 1000', g.gainILS, 270);
  const t = d => Date.parse(d);
  const npv = [[-1000, '2025-01-01'], [620, '2025-07-02'], [650, '2026-01-01']]
    .reduce((s, [v, d]) => s + v / Math.pow(1 + g.mwrPct / 100, (t(d) - t('2025-01-01')) / 864e5 / 365.25), 0);
  near('sale + dividend: MWR zeroes the group NPV', npv, 0, 1e-6);
}

// --------------------------------------------------- snapshot positions

{
  const p = G.snapshotPositions({
    holdings: [{ id: 1, symbol: 'VT', groupId: '2', shares: 3, currentPrice: 100, costBasis: 90, currency: 'USD' }],
    bonds: [{ id: 5, symbol: '1155100', units: 10, costBasis: 101 }],
    cash: { ILS: 50, USD: 2, note: 'x' },
    rates: { USD: 3.6, EUR: 4.1, USDILS: 3.6 },
    holdingPrice: (h, i) => (i === 0 ? 105 : 0),
  });
  check('positions: holding price from the caller, groupId parsed', p.holdings,
    [{ id: 1, symbol: 'VT', groupId: 2, shares: 3, price: 105, currency: 'USD' }]);
  check('positions: bond falls back to cost when no current price', p.bonds,
    [{ id: 5, symbol: '1155100', units: 10, price: 101, currency: 'ILS' }]);
  check('positions: only numeric cash, USD/EUR rates', [p.cash, p.rates], [{ ILS: 50, USD: 2 }, { USD: 3.6, EUR: 4.1 }]);
  check('positions: no undefined anywhere (Firestore rejects it)', JSON.stringify(p).includes('undefined') || hasUndefined(p), false);
}
function hasUndefined(o) {
  if (o === undefined) return true;
  if (o && typeof o === 'object') return Object.values(o).some(hasUndefined);
  return false;
}

// ---------------------------------------------------------- demo data

{
  const demo = await import(pathToFileURL(join(ROOT, 'demo-data.js')).href);
  const p = demo.generateDemoPortfolioData();
  const res = G.build({
    groups: p.groups, holdings: p.holdings, purchases: p.purchases, sales: p.sales,
    dividends: p.dividends || [], splits: p.splits || [],
    valueOf: h => h.shares * h.currentPrice * (h.currency === 'USD' ? p.rates.USD : 1),
    rateFor: c => (c === 'USD' ? p.rates.USD : null),
  });
  check('demo: every group has complete history', res.groups.map(g => [g.id, g.issues.length]), [[1, 0], [2, 0], [3, 0]]);
  check('demo: nothing unassigned', res.unassigned, []);
  check('demo: every group has a rate', res.groups.every(g => g.status === 'ok' && Number.isFinite(g.mwrPct)), true);
}

// ------------------------------------------------- the page loads it

{
  const html = read('portfolio.html');
  check('portfolio.html loads the module', html.includes('<script src="shared/group-returns.js" defer></script>'), true);
  // Every snapshot object literal written with value_before_flow from live state
  // carries positions; the Excel import (cost approximation, no prices) does not.
  const writers = (html.match(/^\s+value_before_flow:/gm) || []).length;  // not the console.log
  const withPositions = (html.match(/positions \? \{ positions|positionsBefore\w* \? \{ positions/g) || []).length;
  check('snapshot writers: 6, of which 5 store positions', [writers, withPositions], [6, 5]);
}

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
