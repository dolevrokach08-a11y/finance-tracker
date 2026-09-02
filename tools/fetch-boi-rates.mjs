// Turns Bank of Israel's published average mortgage rates into data/boi-mortgage-rates.json.
//
// Those rates are the whole input to the early-repayment fee: the order sets the fee from
// the gap between a loan's own rate and the average rate the Bank publishes, both at the
// moment of repayment and at the moment the loan was taken out. Typing four figures by hand
// for a three-tranche mortgage is how someone ends up staring at a number built on a
// placeholder, which is what happened before this file existed.
//
// The Bank publishes one .xls per segment, at a fixed URL, refreshed monthly. It is read
// here directly, by tools/lib/xls-cells.mjs. An earlier version shelled out to LibreOffice
// and that was a mistake twice over: it put a desktop application in the way of anyone
// wanting to refresh the data, and it meant reading back what a spreadsheet chose to
// display rather than what the file stores — rounded numbers, and dates formatted in the
// machine's locale, which produced a table sorted around a publication dated "2026-21-04"
// the first time this ran on a GitHub runner. Reading the records gives full-precision
// doubles and dates as serials, and neither depends on the environment.
//
// Usage:  node tools/fetch-boi-rates.mjs [--check]
//         --check verifies the committed JSON is current without writing.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSheetCells, serialToISO } from './lib/xls-cells.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'boi-mortgage-rates.json');

const SOURCE = {
  url: 'https://www.boi.org.il/boi_files/Pikuah/mashfix.xls',
  // The sheet carrying the current series. Matched loosely: the name embeds the date the
  // series began and would break an exact comparison if the Bank ever restates it.
  sheet: /01\.03\.2013/,
};

// The seven periods the Bank publishes, in the column order the sheet uses. `maxYears` is
// the upper bound of each band, and the sheet's own note says every band includes it, so a
// period of exactly five years falls in "over 1 up to 5".
const BUCKETS = [
  { key: 'over25', maxYears: Infinity, label: 'מעל 25 שנים' },
  { key: 'y20to25', maxYears: 25, label: 'מעל 20 ועד 25' },
  { key: 'y15to20', maxYears: 20, label: 'מעל 15 ועד 20' },
  { key: 'y10to15', maxYears: 15, label: 'מעל 10 ועד 15' },
  { key: 'y5to10', maxYears: 10, label: 'מעל 5 ועד 10' },
  { key: 'y1to5', maxYears: 5, label: 'מעל 1 ועד 5' },
  { key: 'upTo1', maxYears: 1, label: 'עד שנה' },
];

// Column 0 is the weighted average across bands, 1..7 are the bands, 8 is the date the rate
// takes effect. Column 9 holds the reporting month and is not read: it is descriptive, and
// a couple of its rows were typed as text rather than entered as dates.
const COL_FIRST_BAND = 1, COL_EFFECTIVE = 8;

async function download(url) {
  // A plain fetch is served a bot-check page; the Bank's site sits behind Radware and
  // answers a browser User-Agent normally.
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} fetching ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0xd0cf11e0) {
    throw new Error(`${url} did not return an .xls (got ${buf.length} bytes starting ${buf.subarray(0, 4).toString('hex')})`);
  }
  return buf;
}

function parse(file) {
  const { rows: sheet, dateMode1904, sheetName } = readSheetCells(file, SOURCE.sheet);
  const isRate = v => Number.isFinite(v) && v > 0 && v <= 25;

  const rows = [];
  for (const cells of sheet) {
    if (!cells) continue;
    const bands = BUCKETS.map((_, i) => cells[COL_FIRST_BAND + i]);
    const from = serialToISO(cells[COL_EFFECTIVE], dateMode1904);
    // A dated row missing figures is a publication about to vanish silently, and a missing
    // publication does not read as an error downstream — it just hands loans from that
    // month the previous month's rates. Whatever the cause, say so rather than drop it.
    if (from && bands.some(v => v !== undefined) && !bands.every(isRate)) {
      throw new Error(`Publication ${from} has unreadable figures: ${bands.map(v => v === undefined ? '—' : v).join(', ')}`);
    }
    if (!from || !bands.every(isRate)) continue;
    const entry = { from, rates: {} };
    BUCKETS.forEach((b, i) => { entry.rates[b.key] = bands[i]; });
    rows.push(entry);
  }
  if (!rows.length) throw new Error(`Parsed no rate rows from "${sheetName}" — the sheet layout has changed.`);

  // Newest first, which is the order the app wants for "the rate in force today".
  rows.sort((a, b) => (a.from < b.from ? 1 : a.from > b.from ? -1 : 0));

  // One publication per month, so a duplicate date or one well ahead of today would mean
  // the dates came out wrong even though each of them parsed.
  const seen = new Set();
  for (const r of rows) {
    if (seen.has(r.from)) throw new Error(`Two publications dated ${r.from} — the dates parsed wrong.`);
    seen.add(r.from);
  }
  const horizon = new Date(Date.now() + 86400000 * 45).toISOString().slice(0, 10);
  if (rows[0].from > horizon) throw new Error(`Newest publication is ${rows[0].from}, over six weeks out — the dates parsed wrong.`);
  return rows;
}

const build = rows => ({
  source: SOURCE.url,
  segment: 'שקלי לא צמוד',
  note: 'ריביות שנתיות אפקטיביות, כפי שמפרסם בנק ישראל לחישוב עמלת פירעון מוקדם. ' +
        'כל טווח כולל את הגבול העליון שלו.',
  generatedBy: 'tools/fetch-boi-rates.mjs',
  buckets: BUCKETS.map(b => ({ key: b.key, label: b.label, maxYears: b.maxYears === Infinity ? null : b.maxYears })),
  rows,
});

const stable = o => JSON.stringify(o, null, 2) + '\n';

async function main() {
  const check = process.argv.includes('--check');
  const file = await download(SOURCE.url);
  const rows = parse(file);
  // The published figures are dated, so a build that suddenly loses history is a bug in
  // this script rather than a change at the Bank.
  if (rows.length < 100) throw new Error(`Only ${rows.length} rows parsed; expected the full monthly history.`);
  const next = stable(build(rows));

  if (check) {
    if (!existsSync(OUT)) throw new Error(`${OUT} is missing. Run without --check.`);
    const a = JSON.parse(readFileSync(OUT, 'utf8')).rows[0], b = JSON.parse(next).rows[0];
    if (a.from !== b.from) {
      console.error(`✗ boi-mortgage-rates.json is stale: newest row ${a.from}, the Bank now publishes ${b.from}`);
      process.exit(1);
    }
    console.log(`✓ boi-mortgage-rates.json is current (newest ${a.from}, ${rows.length} rows)`);
    return;
  }

  writeFileSync(OUT, next);
  console.log(`✓ ${rows.length} rows, newest ${rows[0].from}, from ${(file.length / 1024).toFixed(0)}KB of .xls`);
}

main().catch(err => { console.error('✗', err.message); process.exit(1); });
