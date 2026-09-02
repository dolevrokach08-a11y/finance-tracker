// Turns Bank of Israel's published average mortgage rates into data/boi-mortgage-rates.json.
//
// Those rates are the whole input to the early-repayment fee: the order sets the fee from
// the gap between a loan's own rate and the average rate the Bank publishes, both at the
// moment of repayment and at the moment the loan was taken out. Typing four figures by
// hand for a three-tranche mortgage is how someone ends up staring at a number built on a
// placeholder, which is exactly what happened before this file existed.
//
// The Bank publishes one .xls per segment, at a fixed URL, refreshed monthly. It is a real
// BIFF workbook, so something has to convert it. Rather than take on an xls parser as a
// dependency — the maintained one is not on npm — this shells out to LibreOffice, which is
// already on this machine and preinstalled on GitHub's ubuntu runners.
//
// Two details cost an hour each if you rediscover them:
//
//   - The CSV filter's ninth token is "save cell contents as shown". Left at its default
//     the export rounds to the two decimals the sheet happens to display, and 4.83 in
//     place of 4.8315499188 moves a fee by tens of shekels. It is false here on purpose.
//   - The workbook holds several sheets and the twelfth token, -1, exports all of them to
//     separate files. The one that matters is named for the date the current series began.
//
// Usage:  node tools/fetch-boi-rates.mjs [--check]
//         --check verifies the committed JSON is current without writing.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'boi-mortgage-rates.json');

const SOURCE = {
  url: 'https://www.boi.org.il/boi_files/Pikuah/mashfix.xls',
  // The sheet carrying the current series. Matched loosely: the name embeds the date the
  // series began and would break an exact comparison if the Bank ever restates it.
  sheet: /01\.03\.2013/,
};

// The seven periods the Bank publishes, in the column order the sheet uses. `maxYears` is
// the upper bound of each band and the sheet's own note says every band includes it, so a
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

function soffice() {
  const candidates = [
    process.env.SOFFICE_BIN,
    'soffice',
    '/usr/bin/soffice',
    'C:/Program Files/LibreOffice/program/soffice.exe',
    'C:/Program Files (x86)/LibreOffice/program/soffice.exe',
  ].filter(Boolean);
  for (const bin of candidates) {
    try {
      execFileSync(bin, ['--version'], { stdio: 'ignore' });
      return bin;
    } catch { /* try the next one */ }
  }
  throw new Error(
    'LibreOffice not found. Install it, or point SOFFICE_BIN at the binary.\n' +
    'It is only needed to convert the Bank\'s .xls; nothing else in the repo uses it.'
  );
}

async function download(url, to) {
  // A plain fetch is served a bot-check page; the Bank's site sits behind Radware and
  // answers a browser User-Agent normally.
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} fetching ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // A BIFF workbook is an OLE compound file; anything else means we were handed a page.
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0xd0cf11e0) {
    throw new Error(`${url} did not return an .xls (got ${buf.length} bytes starting ${buf.subarray(0, 4).toString('hex')})`);
  }
  writeFileSync(to, buf);
  return buf.length;
}

function toCsv(bin, xls, outDir) {
  //                                sep quote charset firstRow fmt lang quoted special asShown formulas trimSpace sheet
  const filter = 'csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,false,false,false,-1';
  execFileSync(bin, ['--headless', '--convert-to', filter, '--outdir', outDir, xls], { stdio: 'ignore' });
  const file = readdirSync(outDir).find(f => f.endsWith('.csv') && SOURCE.sheet.test(f));
  if (!file) {
    throw new Error(
      `No sheet matching ${SOURCE.sheet} among: ${readdirSync(outDir).join(', ')}\n` +
      'The Bank may have renamed or restructured the workbook.'
    );
  }
  return join(outDir, file);
}

// Every field in the rows we want is a bare number or a dd/mm/yyyy date, so splitting on
// commas is safe here and a quote-aware parser would be ceremony.
const cells = line => line.split(',').map(s => s.trim());

const toISO = s => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

function parse(csvPath) {
  const rows = [];
  for (const line of readFileSync(csvPath, 'utf8').split(/\r?\n/)) {
    const c = cells(line);
    if (c.length < 10) continue;
    const rates = c.slice(0, 7).map(Number);       // average sits in column 0; skip it
    const values = c.slice(1, 8).map(Number);      // the seven bands, over25 first
    const from = toISO(c[8]);
    const month = toISO(c[9]);
    if (!from || values.some(v => !Number.isFinite(v) || v <= 0 || v > 25)) continue;
    void rates;
    const entry = { from, rates: {} };
    if (month) entry.month = month.slice(0, 7);
    BUCKETS.forEach((b, i) => { entry.rates[b.key] = values[i]; });
    rows.push(entry);
  }
  if (!rows.length) throw new Error('Parsed no rate rows — the sheet layout has changed.');
  // Newest first, which is the order the app wants for "the rate in force today".
  rows.sort((a, b) => (a.from < b.from ? 1 : a.from > b.from ? -1 : 0));
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
  const dir = mkdtempSync(join(tmpdir(), 'boi-rates-'));
  try {
    const xls = join(dir, 'source.xls');
    const bytes = await download(SOURCE.url, xls);
    const csv = toCsv(soffice(), xls, dir);
    const rows = parse(csv);
    // The published figures are dated, so a build that suddenly loses history is a bug in
    // this script rather than a change at the Bank.
    if (rows.length < 100) throw new Error(`Only ${rows.length} rows parsed; expected the full monthly history.`);
    const next = stable(build(rows));

    if (check) {
      if (!existsSync(OUT)) throw new Error(`${OUT} is missing. Run without --check.`);
      const current = readFileSync(OUT, 'utf8');
      const a = JSON.parse(current).rows[0], b = JSON.parse(next).rows[0];
      if (a.from !== b.from) {
        console.error(`✗ boi-mortgage-rates.json is stale: newest row ${a.from}, the Bank now publishes ${b.from}`);
        process.exit(1);
      }
      console.log(`✓ boi-mortgage-rates.json is current (newest ${a.from}, ${rows.length} rows)`);
      return;
    }

    writeFileSync(OUT, next);
    console.log(`✓ ${rows.length} rows, newest ${rows[0].from}, from ${(bytes / 1024).toFixed(0)}KB of .xls`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch(err => { console.error('✗', err.message); process.exit(1); });
