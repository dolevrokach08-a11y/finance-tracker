// Splits and reverse splits — shared/splits.js and the three places that read it.
//
// ETHA combined every three units into one on 2026-10-06. The price tripled, the unit
// count in the app did not, and the holding showed three times its value. The fix is
// an event (portfolio.splits) read on top of purchases that stay as the broker wrote
// them. This file checks:
//
//   1. the module — units ×to/from, per-unit prices ×from/to, amounts never;
//   2. portfolio.html's recalcHoldingFromPurchases, read out of the page, so a pass
//      here is about the function the holdings screen actually calls — and with no
//      splits recorded it must give exactly what it gave before;
//   3. tax-optimizer's getRemainingLots fed split-adjusted trades;
//   4. that a recorded split survives load, save and the service-worker cache.
//
// Expected values were computed by hand before the first run:
//   A 2026-05-04  30 @ $20.00 + $1 fee   → 601 paid
//   B 2026-08-03  15 @ $18.00            → 270 paid
//   holding 45 units, avg 871/45 = 19.3556
//   split 2026-10-06, 3 → 1             → 15 units, avg 871/15 = 58.0667
//   C 2026-10-07   5 @ $61.00 (post)     → 20 units, avg 1176/20 = 58.80

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(ROOT, p), 'utf8');
vm.runInThisContext(read('shared/splits.js'));
const S = globalThis.FTSplits;

let failed = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const r4 = n => Math.round(n * 1e4) / 1e4;

// Pulls a top-level `function name(...) {...}` out of a source file by brace matching.
// Strings and template literals are skipped so a brace inside one does not count.
function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} not found`);
  let i = src.indexOf('{', start), depth = 0, quote = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`${name}: unbalanced braces`);
}

const ETHA_ID = 1700000000001;
const A = { id: 11, assetId: ETHA_ID, symbol: 'ETHA', date: '2026-05-04T12:00:00.000Z', shares: 30, price: 20, original_price: 20, original_amount: 600, originalAmount: 601, fee: 1, currency: 'USD', amount: 2200 };
const B = { id: 12, assetId: ETHA_ID, symbol: 'ETHA', date: '2026-08-03T12:00:00.000Z', shares: 15, price: 18, original_price: 18, original_amount: 270, originalAmount: 270, fee: 0, currency: 'USD', amount: 980 };
const C = { id: 13, assetId: ETHA_ID, symbol: 'ETHA', date: '2026-10-07T12:00:00.000Z', shares: 5, price: 61, original_price: 61, original_amount: 305, originalAmount: 305, fee: 0, currency: 'USD', amount: 1130 };
const SPLIT = { id: 'split_1', symbol: 'ETHA', assetId: ETHA_ID, date: '2026-10-06', from: 3, to: 1 };

// ── 1. The module ──────────────────────────────────────────────────────────────
console.log('— module');

const a = S.adjustTrade(A, [SPLIT]);
check('pre-split purchase: units ÷3', a.shares, 10);
check('pre-split purchase: per-unit prices ×3', [a.price, a.original_price], [60, 60]);
check('pre-split purchase: amounts untouched', [a.original_amount, a.originalAmount, a.amount, a.fee], [600, 601, 2200, 1]);
check('pre-split purchase: the stored record is not mutated', [A.shares, A.price], [30, 20]);
check('adjusted copy says what it was', a.splitAdjusted, { originalShares: 30, splits: ['split_1'] });

const onDay = { ...C, date: '2026-10-06T12:00:00.000Z' };
check('trade on the split date is already on the new basis', S.adjustTrade(onDay, [SPLIT]), onDay);
check('trade after the split is unchanged', S.adjustTrade(C, [SPLIT]), C);
check('another symbol is unchanged', S.adjustTrade({ ...A, symbol: 'IBIT', assetId: 99 }, [SPLIT]).shares, 30);
check('renamed holding still matched by assetId', S.adjustTrade({ ...A, symbol: 'ETHA-OLD' }, [SPLIT]).shares, 10);
// GPT round 1, finding 1: two holdings with one symbol (a regular account and an IRA).
check('a different holding id is not matched by symbol', S.adjustTrade({ ...A, assetId: 2 }, [{ ...SPLIT, assetId: 1 }]).shares, 30);
check('a trade with no holding id falls back to the symbol', S.adjustTrade({ ...A, assetId: null }, [SPLIT]).shares, 10);
check('symbol match is case-insensitive', S.adjustTrade({ ...A, symbol: 'etha', assetId: undefined }, [SPLIT]).shares, 10);
// GPT rounds 1–2, the day boundary. The split takes effect at the exchange's open, so a
// trade's day is its calendar day at the exchange. ETHA's 8-K: effective at the open
// on 6 Oct 2026 on Nasdaq. 22:30Z on 5 Oct is 01:30 on the 6th in Israel and 18:30 on
// the 5th in New York — still the old basis. The first version used the UTC day (right
// here by accident); the round-1 fix used the Israeli day (wrong here); round 2 caught it.
check('exchange zone from the symbol', ['ETHA', 'CSPX.L', '1159235', 'TEVA.TA', 'X.XX', ''].map(S.exchangeTimeZone),
  ['America/New_York', 'Europe/London', 'Asia/Jerusalem', 'Asia/Jerusalem', 'UTC', 'UTC']);
check('22:30Z on 5 Oct, ETHA (18:30 New York) → old basis, converted',
  S.adjustTrade({ ...A, date: '2026-10-05T22:30:00.000Z' }, [SPLIT]).shares, 10);
check('00:30Z on 6 Oct, ETHA (20:30 New York on the 5th) → still converted',
  S.adjustTrade({ ...A, date: '2026-10-06T00:30:00.000Z' }, [SPLIT]).shares, 10);
check('13:30Z on 6 Oct, ETHA (09:30 New York, the open) → new basis',
  S.adjustTrade({ ...A, date: '2026-10-06T13:30:00.000Z' }, [SPLIT]).shares, 30);
const TASE = { ...SPLIT, id: 'ta', symbol: '1159235', assetId: 7 };
const taTrade = { ...A, symbol: '1159235', assetId: 7 };
check('22:30Z on 5 Oct, Tel Aviv security (01:30 on the 6th) → new basis',
  S.adjustTrade({ ...taTrade, date: '2026-10-05T22:30:00.000Z' }, [TASE]).shares, 30);
check("a split's own tz wins over its symbol",
  S.adjustTrade({ ...A, date: '2026-10-05T22:30:00.000Z' }, [{ ...SPLIT, tz: 'Asia/Jerusalem' }]).shares, 30);
check('an unknown tz makes the split invalid', S.validate({ ...SPLIT, tz: 'Mars/Olympus' }).length, 1);
for (const tz of ['America/New_York', 'Europe/London', 'Asia/Jerusalem', 'America/Toronto', 'UTC']) {
  check(`form dates (noon UTC) keep their calendar day in ${tz}`, S.dayOf('2026-10-05T12:00:00.000Z', tz), '2026-10-05');
}
check('a bare YYYY-MM-DD is taken as is', S.dayOf('2026-10-05', 'Asia/Jerusalem'), '2026-10-05');
check('no splits → same array back', S.adjustTrades([A, B], []), [A, B]);

const fwd = { ...SPLIT, id: 'f', from: 1, to: 2 };
check('forward split 1→2: units ×2, price ÷2', [S.adjustTrade(A, [fwd]).shares, S.adjustTrade(A, [fwd]).price], [60, 10]);
const later = { ...SPLIT, id: 's2', date: '2027-03-01', from: 1, to: 2 };
const both = S.adjustTrade(A, [later, SPLIT]);
check('two splits compound in date order (×1/3 then ×2)', [both.shares, both.price], [20, 30]);
check('a trade between two splits takes only the later one', S.adjustTrade(C, [SPLIT, later]).shares, 10);

for (const t of [A, B]) {
  const x = S.adjustTrade(t, [SPLIT]);
  check(`paid amount invariant for purchase ${t.id} (units × price)`, near(x.shares * x.price, t.shares * t.price), true);
}

check('valid split has no errors', S.validate(SPLIT), []);
check('1:1 is refused', S.validate({ ...SPLIT, from: 2, to: 2 }).length, 1);
check('non-positive ratio refused', S.validate({ ...SPLIT, from: 0 }).length, 1);
check('impossible date refused', S.validate({ ...SPLIT, date: '2026-02-30' }).length, 1);
check('missing symbol refused', S.validate({ ...SPLIT, symbol: ' ' }).length, 1);
check('an invalid split adjusts nothing', S.adjustTrade(A, [{ ...SPLIT, from: 0 }]).shares, 30);

const hist0 = S.fromHistory([A, B], [], []);
check('history without split: 45 units, avg 19.3556', [hist0.shares, r4(hist0.costBasis)], [45, 19.3556]);
const hist1 = S.fromHistory([A, B], [], [SPLIT]);
check('history with split: 15 units, avg 58.0667', [hist1.shares, r4(hist1.costBasis)], [15, 58.0667]);
check('total cost is invariant across the split', near(hist0.shares * hist0.costBasis, hist1.shares * hist1.costBasis), true);

// 100 units → 33.333… The broker redeems the third; it is recorded as a sale.
const odd = { ...A, shares: 100, original_amount: 2000, originalAmount: 2000, fee: 0 };
const fraction = { id: 21, assetId: ETHA_ID, symbol: 'ETHA', date: '2026-10-08T12:00:00.000Z', shares: 0.333333333 };
check('fractional unit after a reverse split, then cash in lieu as a sale → exactly 33',
  S.fromHistory([odd], [fraction], [SPLIT]).shares, 33);

console.log('— planHoldingChange');
const holding = { id: ETHA_ID, symbol: 'ETHA', shares: 45, costBasis: 871 / 45, currency: 'USD', currentPrice: 60.89 };
const scale = S.planHoldingChange({ holding, purchases: [A, B], sales: [], prevSplits: [], nextSplits: [SPLIT], changed: SPLIT });
check('all trades before the split → scale', scale.method, 'scale');
check('scale: 15 units, avg 58.0667', [scale.shares, r4(scale.costBasis)], [15, 58.0667]);
check('scale: value at today\'s price falls from 2,740.05 to 913.35',
  [r4(holding.shares * holding.currentPrice), r4(scale.shares * holding.currentPrice)], [2740.05, 913.35]);

// Hand-edited holding (no purchase history agrees with it) and nothing after the split:
// scale is exact regardless — the user's cost is kept, only restated.
const edited = { ...holding, shares: 46, costBasis: 19 };
const scaleEdited = S.planHoldingChange({ holding: edited, purchases: [A, B], sales: [], prevSplits: [], nextSplits: [SPLIT], changed: SPLIT });
check('scale ignores a disagreeing history: 46 → 15.333333333, cost 19 → 57',
  [scaleEdited.method, scaleEdited.shares, r4(scaleEdited.costBasis)], ['scale', 15.333333333, 57]);

// Split recorded late: a post-split buy of 5 is already in the holding (45 + 5).
const late = { ...holding, shares: 50, costBasis: 1176 / 50 };
const hist = S.planHoldingChange({ holding: late, purchases: [A, B, C], sales: [], prevSplits: [], nextSplits: [SPLIT], changed: SPLIT });
check('a trade after the split → history', hist.method, 'history');
check('history: 15 + 5 = 20 units, avg 58.80', [hist.shares, r4(hist.costBasis)], [20, 58.8]);

const refused = S.planHoldingChange({ holding: { ...late, shares: 52 }, purchases: [A, B, C], sales: [], prevSplits: [], nextSplits: [SPLIT], changed: SPLIT });
check('history that disagrees with the holding is refused, not overwritten', typeof refused.error, 'string');

// GPT round 1, finding 2: units agree with history, the average cost was typed by hand.
const handCost = S.planHoldingChange({ holding: { ...late, costBasis: 30 }, purchases: [A, B, C], sales: [], prevSplits: [], nextSplits: [SPLIT], changed: SPLIT });
check('history path refuses when the hand-entered cost disagrees, instead of replacing it',
  [typeof handCost.error, handCost.shares], ['string', undefined]);
const handCostScale = S.planHoldingChange({ holding: { ...holding, costBasis: 30 }, purchases: [A, B], sales: [], prevSplits: [], nextSplits: [SPLIT], changed: SPLIT });
check('scale path keeps a hand-entered cost, restated: 30 → 90', [handCostScale.method, r4(handCostScale.costBasis)], ['scale', 90]);
const undoScale = S.planHoldingChange({ holding: { ...holding, ...scale }, purchases: [A, B], sales: [], prevSplits: [SPLIT], nextSplits: [], changed: SPLIT });
check('removing the split restores 45 units and the original avg',
  [undoScale.shares, r4(undoScale.costBasis)], [45, r4(871 / 45)]);
const undoHist = S.planHoldingChange({ holding: { ...late, ...hist }, purchases: [A, B, C], sales: [], prevSplits: [SPLIT], nextSplits: [], changed: SPLIT });
check('removing it with a later trade restores 50 units',
  [undoHist.method, undoHist.shares, r4(undoHist.costBasis)], ['history', 50, r4(1176 / 50)]);

// ── 2. The page's own recalc ───────────────────────────────────────────────────
console.log('— portfolio.html recalcHoldingFromPurchases');
const page = read('portfolio.html');
const recalcSrc = extractFunction(page, 'recalcHoldingFromPurchases');
function runRecalc(portfolio, symbol, assetId) {
  const ctx = { portfolio, window: { FTSplits: S }, console: { log() {} } };
  vm.createContext(ctx);
  vm.runInContext(`${recalcSrc}; recalcHoldingFromPurchases(${JSON.stringify(symbol)}, ${JSON.stringify(assetId)});`, ctx);
  return portfolio.holdings[0];
}
const fresh = () => ({ holdings: [{ ...holding }], purchases: [{ ...A }, { ...B }, { ...C }], sales: [] });

const noSplit = runRecalc({ ...fresh() }, 'ETHA', ETHA_ID);
check('no splits recorded: recalc is what it always was (50 units, avg 23.52)', [noSplit.shares, r4(noSplit.costBasis)], [50, 23.52]);
const withSplit = runRecalc({ ...fresh(), splits: [SPLIT] }, 'ETHA', ETHA_ID);
check('split recorded: recalc agrees with planHoldingChange (20, 58.80)', [withSplit.shares, r4(withSplit.costBasis)], [hist.shares, r4(hist.costBasis)]);
const p2 = fresh();
runRecalc({ ...p2, splits: [SPLIT] }, 'ETHA', ETHA_ID);
check('recalc does not rewrite stored purchases', p2.purchases.map(p => p.shares), [30, 15, 5]);

check('the page loads shared/splits.js before its module script',
  page.indexOf('src="shared/splits.js"') > 0 && page.indexOf('src="shared/splits.js"') < page.indexOf('<script type="module">'), true);
check('saveData persists splits', /splits: portfolio\.splits \|\| \[\]/.test(page), true);
check('applying a split closes the edit form when it is open on that holding',
  /function finishSplitChange[\s\S]{0,600}editingHoldingId === holdingId\) hideAddHoldingForm\(\)/.test(page), true);
check('the split is a row action, not a field of the edit form',
  page.includes('onclick="showSplitModal(${holding.id})"') && !page.includes('split-holding-btn'), true);
check('the dialog is announced as a modal dialog with a name',
  /role="dialog" aria-modal="true" aria-labelledby="split-modal-title"/.test(page), true);

const listSrc = extractFunction(page, 'splitsForHolding');
const listCtx = { portfolio: { splits: [{ ...SPLIT, assetId: 1 }, { ...SPLIT, id: 'legacy', assetId: undefined }] } };
vm.createContext(listCtx);
const listFor = id => vm.runInContext(`${listSrc}; splitsForHolding({ id: ${id}, symbol: 'ETHA' }).map(s => s.id)`, listCtx);
check('the events list of holding 1 shows its own split and the id-less one', listFor(1), ['split_1', 'legacy']);
check("the events list of holding 2 does not show holding 1's split", listFor(2), ['legacy']);

// ── 3. Tax optimizer lots ──────────────────────────────────────────────────────
console.log('— tax-optimizer getRemainingLots');
const jsx = read('tax-optimizer.src.jsx');
const lotsFn = vm.runInNewContext(`(${extractFunction(jsx, 'getRemainingLots')})`);
const lots = lotsFn(S.adjustTrades([A, B], [SPLIT]), [], 'ETHA');
check('lots in today\'s units: 10 @ 60.10 and 5 @ 54.00',
  lots.map(l => [l.remaining, r4(l.price)]), [[10, 60.1], [5, 54]]);
check('unadjusted lots would be 30 + 15 — the bug this prevents',
  lotsFn([A, B], [], 'ETHA').map(l => l.remaining), [30, 15]);
check('runCPISim adjusts purchases and sales when splits exist',
  /purchases = window\.FTSplits\.adjustTrades\(purchases, splits\)/.test(jsx) &&
  /sales\s+= window\.FTSplits\.adjustTrades\(sales, splits\)/.test(jsx), true);
const taxHtml = read('tax-optimizer.html');
check('tax-optimizer.html loads shared/splits.js and reads portfolioData.splits',
  taxHtml.includes('src="shared/splits.js"') && taxHtml.includes('portfolioData.splits'), true);
check('the built tax-optimizer.app.js carries the split adjustment',
  read('tax-optimizer.app.js').includes('FTSplits.adjustTrades'), true);

// ── 4. Persistence ─────────────────────────────────────────────────────────────
console.log('— persistence');
// data.js is a plain browser script; run it against a stub window to reach FTData.
const dataCtx = { window: {}, console };
vm.createContext(dataCtx);
vm.runInContext(read('shared/data.js'), dataCtx);
const FTData = dataCtx.window.FTData;
const loaded = FTData.normalizePortfolio({ holdings: [], splits: [SPLIT] }, { source: 'cloud' });
check('normalizePortfolio keeps splits', loaded.splits, [SPLIT]);
check('normalizePortfolio defaults splits to []', FTData.normalizePortfolio({}, { source: 'cloud' }).splits, []);
const sw = read('sw.js');
check('service worker precaches shared/splits.js', sw.includes("'shared/splits.js'"), true);

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
