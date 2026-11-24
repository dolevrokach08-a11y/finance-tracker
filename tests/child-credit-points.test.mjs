// Child credit points per parent, by the child's age in the tax year.
//
// The screen used to give the father nothing from age 6 and the mother 1 point for all
// of 6–17, and its footnote said only the mother gets points from 6. Both were wrong for
// every year the screen covers: since 2022 ages 6–12 give father 1 / mother 2, and since
// 2024 ages 13–17 do too. Only age 18 is the mother's alone. The 2024 toddler addition
// (+1 birth year, +2 ages 1–2, +1 age 3, to each parent) was also applied to 2022–2023.
//
// Sources: חוק הגדלת נקודות זיכוי להורים במס הכנסה והרחבת מענק עבודה, התשפ"ג–2023;
// kolzchut "נקודות זיכוי ממס הכנסה להורה לילד עד גיל 5" (2023: 1.5 / 2.5 for the father);
// taxes-refund.co.il year-by-year table for ages 6–17 (2020-21, 2022-23, 2024+).
//
// childCreditPoints is read out of the source because the file is a React component tree;
// tools/build-assets.mjs --check keeps the shipped bundle in step with it.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NL = String.fromCharCode(10);
const src = readFileSync(join(ROOT, 'tax-optimizer.src.jsx'), 'utf8').replace(/\r/g, '');

const from = src.indexOf('function childCreditPoints(');
const to = src.indexOf(NL + '}', from);
if (from === -1 || to === -1) {
  console.error('✗ could not find childCreditPoints in tax-optimizer.src.jsx — this test is checking nothing.');
  process.exit(1);
}
const childCreditPoints = new Function(src.slice(from, to + 2) + '; return childCreditPoints;')();

let failed = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `   got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};
const pts = (father, mother) => ({ father, mother });

// From 2024 — the table on screen, row by row.
for (const y of [2024, 2025, 2026, 2027]) {
  check(`${y} birth year`, childCreditPoints(0, y), pts(2.5, 2.5));
  check(`${y} age 1`, childCreditPoints(1, y), pts(4.5, 4.5));
  check(`${y} age 2`, childCreditPoints(2, y), pts(4.5, 4.5));
  check(`${y} age 3`, childCreditPoints(3, y), pts(3.5, 3.5));
  check(`${y} age 4`, childCreditPoints(4, y), pts(2.5, 2.5));
  check(`${y} age 5`, childCreditPoints(5, y), pts(2.5, 2.5));
  check(`${y} age 6`, childCreditPoints(6, y), pts(1, 2));
  check(`${y} age 12`, childCreditPoints(12, y), pts(1, 2));
  check(`${y} age 13`, childCreditPoints(13, y), pts(1, 2));
  check(`${y} age 17`, childCreditPoints(17, y), pts(1, 2));
  check(`${y} age 18 — mother only`, childCreditPoints(18, y), pts(0, 0.5));
  check(`${y} age 19 — nothing`, childCreditPoints(19, y), pts(0, 0));
}

// 2022–2023 — before the toddler addition and before 13–17 rose.
for (const y of [2022, 2023]) {
  check(`${y} birth year`, childCreditPoints(0, y), pts(1.5, 1.5));
  check(`${y} age 1`, childCreditPoints(1, y), pts(2.5, 2.5));
  check(`${y} age 3`, childCreditPoints(3, y), pts(2.5, 2.5));
  check(`${y} age 5`, childCreditPoints(5, y), pts(2.5, 2.5));
  check(`${y} age 6–12 already raised in 2022`, childCreditPoints(9, y), pts(1, 2));
  check(`${y} age 13–17 not yet raised`, childCreditPoints(15, y), pts(0, 1));
  check(`${y} age 18`, childCreditPoints(18, y), pts(0, 0.5));
}

// Before 2022 (not selectable today, but the rule must not silently use the new law).
check('2021 age 9', childCreditPoints(9, 2021), pts(0, 1));

// Bad input is no child, not NaN points.
check('negative age', childCreditPoints(-1, 2026), pts(0, 0));
check('missing age', childCreditPoints(undefined, 2026), pts(0, 0));

// The screen's default family (ages 3, 2, 0) in 2026: 3.5 + 4.5 + 2.5 = 10.5 each.
const sum = (ages, y, who) => ages.reduce((s, a) => s + childCreditPoints(a, y)[who], 0);
check('default family 2026 — father', sum([3, 2, 0], 2026, 'father'), 10.5);
check('default family 2026 — mother', sum([3, 2, 0], 2026, 'mother'), 10.5);
check('ages 8 and 15 in 2026 — father', sum([8, 15], 2026, 'father'), 2);
check('ages 8 and 15 in 2026 — mother', sum([8, 15], 2026, 'mother'), 4);
check('ages 8 and 15 in 2023 — father', sum([8, 15], 2023, 'father'), 1);
check('ages 8 and 15 in 2023 — mother', sum([8, 15], 2023, 'mother'), 3);

if (failed) {
  console.error(`\n✗ ${failed} failed`);
  process.exit(1);
}
console.log('\n✓ all passed');
