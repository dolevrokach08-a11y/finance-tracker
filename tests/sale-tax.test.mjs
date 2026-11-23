// Capital-gains tax events — shared/sale-tax.js.
//
// Expected values were written by hand before the first run:
//
//   One sale, same currency: profit $100 (pre-tax), event $25 at 3.6
//     cash.USD 1000 → 975; net $75; tax in ILS 25 × 3.6 = 90.
//   One tax on two sales (the HAE + BILL case): HAE −$20, BILL +$84 →
//     all to BILL (a loss takes no tax); BILL net 84 − 16.85 = 67.15; HAE stays −20.
//   Two gains: $30 and $90 at 3.7 (111 / 333 ILS) → weights 0.25 / 0.75;
//     a $20 event → $5 / $15.
//   Mixed currencies: $100 at 3.5 (350 ILS) and ₪150 → 0.7 / 0.3.
//   Different currency: $100 profit at 3.7, event ₪74 → cash.ILS −74, cash.USD
//     untouched; net 100 − 74 / 3.7 = $80.
//   Refund: ₪−30 on a ₪−200 sale → cash.ILS +30, net −170. Two losses −100 / −300
//     → 0.25 / 0.75.
//   Legacy bond sale: tax 45.01, no taxCurrency, profit 154.99 → embedded
//     ₪45.01, pre-tax 200, net (no events) 154.99.
//   Legacy cross-currency: USD sale, tax ₪74, profit $80, rate 3.7 → pre-tax $100.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(ROOT, p), 'utf8');
vm.runInThisContext(read('shared/sale-tax.js'));
vm.runInThisContext(read('shared/splits.js'));
vm.runInThisContext(read('shared/group-returns.js'));
const T = globalThis.FTSaleTax;
const G = globalThis.FTGroupReturns;

let failed = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};
const near = (label, got, want, eps = 1e-9) => {
  const ok = typeof got === 'number' && Math.abs(got - want) <= eps;
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : `  — got ${got}, want ${want}`}`);
};

const usdSale = (id, profit, extra = {}) => ({
  id, date: '2026-11-19T12:00:00.000Z', symbol: 'S' + id, shares: 1, original_currency: 'USD', currency: 'USD',
  profit, ils_rate: 3.7, tax: 0, assetType: 'stocks', ...extra,
});
const ev = (o) => {
  const r = T.buildEvent({ id: 1, date: '2026-11-24', ...o });
  if (r.errors) throw new Error('buildEvent: ' + r.errors.join(','));
  return r.event;
};

// ------------------------------------------------ tax on one sale

{
  const sale = usdSale(10, 100);
  const e = ev({ amount: 25, currency: 'USD', sales: [sale], rates: { USD: 3.6 } });
  const cash = T.applyToCash({ ILS: 0, USD: 1000, EUR: 0 }, e, 1);
  check('one sale: cash.USD 1000 → 975, other currencies untouched', cash, { ILS: 0, USD: 975, EUR: 0 });
  near('one sale: net profit $75', T.netProfit(sale, [e]), 75);
  near('one sale: tax in ILS at the event day rate (90)', T.totalTaxILS(sale, [e]), 90);
  check('one sale: the sale record is not touched', sale, usdSale(10, 100));
}

// ------------------------------------------------ one tax over several sales

{
  const hae = usdSale(1, -20), bill = usdSale(2, 84);
  const e = ev({ amount: 16.85, currency: 'USD', sales: [hae, bill], rates: { USD: 3.65 } });
  check('HAE+BILL: a sale at a loss takes no tax', e.weights, { 1: 0, 2: 1 });
  near('HAE+BILL: BILL net 84 − 16.85', T.netProfit(bill, [e]), 67.15);
  near('HAE+BILL: HAE net unchanged', T.netProfit(hae, [e]), -20);
  const cash = T.applyToCash({ ILS: 500, USD: 300, EUR: 0 }, e, 1);
  near('HAE+BILL: cash.USD down by exactly 16.85', cash.USD, 300 - 16.85);
  check('HAE+BILL: cash.ILS untouched', cash.ILS, 500);

  const a = usdSale(3, 30), b = usdSale(4, 90);
  const e2 = ev({ amount: 20, currency: 'USD', sales: [a, b], rates: { USD: 3.7 } });
  near('two gains: weight 0.25', e2.weights[3], 0.25);
  near('two gains: weight 0.75', e2.weights[4], 0.75);
  near('two gains: $5 to the smaller', T.allocatedTax(a, [e2])[0].amount, 5);
  near('two gains: $15 to the larger', T.allocatedTax(b, [e2])[0].amount, 15);

  const m1 = usdSale(5, 100, { ils_rate: 3.5 });
  const m2 = { id: 6, currency: 'ILS', profit: 150, tax: 0, assetType: 'stocks', date: '2026-11-19' };
  const w = T.allocationWeights([m1, m2]);
  near('mixed currencies: compared in ILS (0.7)', w[5], 0.7);
  near('mixed currencies: compared in ILS (0.3)', w[6], 0.3);

  const z1 = usdSale(7, 0), z2 = usdSale(8, 0);
  check('all gains zero: split equally', T.allocationWeights([z1, z2]), { 7: 0.5, 8: 0.5 });
}

// ------------------------------------------------ tax in a different currency

{
  const sale = usdSale(20, 100);
  const e = ev({ amount: 74, currency: 'ILS', sales: [sale], rates: { USD: 3.7 } });
  const cash = T.applyToCash({ ILS: 1000, USD: 200, EUR: 0 }, e, 1);
  check('ILS tax on a USD sale: comes off cash.ILS only', cash, { ILS: 926, USD: 200, EUR: 0 });
  near('ILS tax on a USD sale: net in USD 100 − 74/3.7', T.netProfit(sale, [e]), 80);
  near('ILS tax on a USD sale: ILS amount is the amount', T.totalTaxILS(sale, [e]), 74);
}

// ------------------------------------------------ refund

{
  const loss = { id: 30, currency: 'ILS', profit: -200, tax: 0, assetType: 'stocks', date: '2026-11-20' };
  const e = ev({ amount: -30, currency: 'ILS', sales: [loss] });
  check('refund: adds to cash', T.applyToCash({ ILS: 100 }, e, 1), { ILS: 130 });
  near('refund: net −200 + 30', T.netProfit(loss, [e]), -170);
  const l1 = { ...loss, id: 31, profit: -100 }, l2 = { ...loss, id: 32, profit: -300 };
  const w = T.allocationWeights([l1, l2]);
  check('refund after two losses: split by the size of the loss', [w[31], w[32]], [0.25, 0.75]);
}

// ------------------------------------------------ edit and delete are exact reversals

{
  const sale = usdSale(40, 50);
  const start = { ILS: 1000, USD: 500, EUR: 0 };
  const cash = { ...start };
  const e1 = ev({ amount: 16.85, currency: 'USD', sales: [sale], rates: { USD: 3.6 } });
  T.applyToCash(cash, e1, 1);
  const e2 = ev({ amount: 60, currency: 'ILS', sales: [sale], rates: { USD: 3.6 } });
  T.replaceInCash(cash, e1, e2);
  near('edit USD → ILS: USD restored', cash.USD, 500);
  near('edit USD → ILS: ILS charged', cash.ILS, 940);
  T.applyToCash(cash, e2, -1);
  near('delete: ILS back to start', cash.ILS, start.ILS);
  near('delete: USD back to start', cash.USD, start.USD);
}

// ------------------------------------------------ legacy records

{
  const bond = { id: 50, currency: 'ILS', assetType: 'bonds', profit: 154.99, tax: 45.01, date: '2025-05-01' };
  check('legacy bond: no taxCurrency means the sale currency', T.embeddedTax(bond), { amount: 45.01, currency: 'ILS' });
  near('legacy bond: pre-tax profit adds it back', T.preTaxProfit(bond), 200);
  near('legacy bond: net profit is the stored profit', T.netProfit(bond, []), 154.99);
  near('legacy bond: tax shown', T.totalTaxILS(bond, []), 45.01);

  const oldStock = { id: 51, symbol: 'VT', currency: 'USD', profit: 40, date: '2024-03-01' };
  check('old stock sale without tax: nothing embedded', T.embeddedTax(oldStock), null);
  near('old stock sale without tax: net = profit', T.netProfit(oldStock, []), 40);
  check('old stock sale without tax: not pending', T.isPending(oldStock, []), false);

  const cross = usdSale(52, 80, { tax: 74, taxCurrency: 'ILS' });
  near('legacy cross-currency: pre-tax $100', T.preTaxProfit(cross), 100);
  near('legacy cross-currency: tax shown ₪74', T.totalTaxILS(cross, []), 74);

  // A legacy sale with embedded tax can take an event on top (e.g. a correction).
  const e = ev({ amount: -10, currency: 'ILS', sales: [bond] });
  near('legacy + event: event comes off the stored net profit', T.netProfit(bond, [e]), 164.99);
}

// ------------------------------------------------ pending and validation

{
  const s = usdSale(60, 10, { taxPending: true });
  check('pending: marked and no event', T.isPending(s, []), true);
  const e = ev({ amount: 2, currency: 'USD', sales: [s], rates: { USD: 3.6 } });
  check('pending: clears once an event is linked', T.isPending(s, [e]), false);

  const bad = T.buildEvent({ id: 9, date: '2026-11-24', amount: 0, currency: 'USD', sales: [], rates: {} });
  check('validation: zero amount, no sales, no rate', bad.errors, ['amount', 'sales', 'rate']);
  const bad2 = T.buildEvent({ id: 9, date: '', amount: 5, currency: 'GBP', sales: [s] });
  check('validation: unknown currency and missing date', bad2.errors, ['currency', 'date', 'rate']);
}

// ------------------------------------------------ implicit-cash split by asset type

{
  const st = { id: 70, assetType: 'stocks' }, bd = { id: 71, assetType: 'bonds' };
  const e = { id: 1, amount: 100, currency: 'ILS', ils_rate: 1, saleIds: [70, 71], weights: { 70: 0.6, 71: 0.4 } };
  const r = T.eventsILSByAssetType([e], [st, bd]);
  near('implicit cash: stocks share', r.stocks, 60);
  near('implicit cash: bonds share', r.bonds, 40);
}

// ------------------------------------------------ group returns stay pre-tax

{
  // The same sale written the old way (tax $20 embedded) and the new way
  // (tax 0, tax in an event). Group returns read gross − commission, so both
  // must give the same proceeds — moving the tax out must not move the table.
  const base = { currency: 'USD', original_currency: 'USD', date: '2025-03-15T12:00:00.000Z', shares: 4, original_price: 100, gross_amount: 400, commission: 2, ils_rate: 3.7 };
  const oldWay = G._read.saleILS({ ...base, tax: 20, taxCurrency: 'USD', original_amount: 378, amount: 1398.6 }, () => 3.7);
  const newWay = G._read.saleILS({ ...base, tax: 0, original_amount: 398, amount: 1472.6 }, () => 3.7);
  near('group returns: old and new record give the same proceeds', newWay.ils, oldWay.ils);
}

// ------------------------------------------------ persistence wiring

{
  const html = read('portfolio.html');
  check('portfolio.html loads the module', html.includes('<script src="shared/sale-tax.js" defer></script>'), true);
  check('saveData writes taxEvents', /taxEvents:\s*portfolio\.taxEvents\s*\|\|\s*\[\]/.test(html), true);

  globalThis.window = globalThis;
  vm.runInThisContext(read('shared/data.js'));
  const D = globalThis.FTData;
  const events = [{ id: 1, amount: 16.85, currency: 'USD' }];
  check('normalizePortfolio keeps taxEvents (cloud)', D.normalizePortfolio({ taxEvents: events }, { source: 'cloud' }).taxEvents, events);
  check('normalizePortfolio keeps taxEvents (local)', D.normalizePortfolio({ taxEvents: events }, { source: 'local' }).taxEvents, events);
  check('normalizePortfolio defaults taxEvents to []', D.normalizePortfolio({}, { source: 'cloud' }).taxEvents, []);
}

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
