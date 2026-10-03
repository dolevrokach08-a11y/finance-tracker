// A fixed income/expense that spans several years must make every one of those
// years pickable — not just the year it starts and the year it ends. Both year
// selectors in finance.html (the main "שנה" picker built by getDataYears(), and
// the reports-tab "report-period" selector built by updateReportPeriodSelector())
// used to add only the two endpoints, so a record spanning N years left the N-2
// years in between unreachable in the picker.
//
// Years here are relative to "today" rather than a fixed year like 2044, so the
// test keeps testing the real gap (start+1 .. end-1) instead of a range that
// drifts into the past as calendar years pass.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../finance.html', import.meta.url), 'utf8');
const grab = (a, b) => {
  const s = html.indexOf(a), e = html.indexOf(b, s + a.length);
  if (s < 0 || e < 0) throw new Error(`marker not found: ${a}`);
  return html.slice(s, e);
};

let failures = 0;
const ok = (cond, name, got = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  got: ${got}`}`);
  if (!cond) failures++;
};

const curYear = new Date().getFullYear();
const span = { start: `${curYear - 3}-01`, end: `${curYear + 3}-06` };
const expectedYears = [];
for (let y = curYear - 3; y <= curYear + 3; y++) expectedYears.push(y);

// ── getDataYears(): the main "שנה" picker ────────────────────────────────────
{
  const src = [
    grab('function addFixedRecordYears', 'function getDataYears'),
    grab('function getDataYears', 'function populateYearMonthSelectors'),
  ].join('\n');

  // getDataYears() closes over the module-level `data`; passing it in as a
  // parameter of the same name lets the extracted source run unmodified.
  const run = new Function('data', src + '\nreturn getDataYears();');

  const data = {
    transactions: [],
    fixedIncomes: [{ start: span.start, end: span.end }],
    fixedExpenses: [],
  };
  const years = run(data);
  for (const y of expectedYears) {
    ok(years.includes(y), `getDataYears includes ${y} (between ${span.start} and ${span.end})`, years.join(','));
  }
}

// ── updateReportPeriodSelector(): the reports-tab picker must reuse the same
// helper rather than carry its own start/end-only copy again. ──────────────
{
  const fnSrc = grab('function updateReportPeriodSelector', 'function ');
  assert.ok(fnSrc.includes('addFixedRecordYears('),
    'updateReportPeriodSelector must call the shared addFixedRecordYears helper, not re-inline the start/end-only logic');
  ok(fnSrc.includes('addFixedRecordYears('),
    'report-period selector reuses addFixedRecordYears instead of duplicating the bug');
}

if (failures) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}
console.log('✓ finance year selectors: every year in a fixed record\'s range is offered');
