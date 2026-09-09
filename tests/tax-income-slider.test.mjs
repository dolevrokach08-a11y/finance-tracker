import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'tax-optimizer.src.jsx'), 'utf8');

const start = src.indexOf('function sliderCeiling(');
const end = src.indexOf('\n}', start);
if (start < 0 || end < 0) throw new Error('sliderCeiling is missing');
const sliderCeiling = new Function(`${src.slice(start, end + 2)}; return sliderCeiling;`)();

let failed = 0;
const check = (label, condition) => {
  if (!condition) failed++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`);
};

check('ordinary income keeps the familiar 15,000 ceiling', sliderCeiling(9000, 15000, 250) === 15000);
check('restored income above 15,000 expands instead of clamping', sliderCeiling(32750, 15000, 250) === 32750);
check('imported income is rounded upward only for the visual ceiling', sliderCeiling(32810, 15000, 250) === 33000);
check('the controlled value remains the original state value',
  src.includes('max={effectiveMax} step={step} value={value}'));
check('father restore button writes the payslip average directly',
  src.includes('setFM(Math.round(payslipAverages.fatherAvg / 250) * 250)'));
check('mother restore button writes the payslip average directly',
  src.includes('setMM(Math.round(payslipAverages.motherAvg / 250) * 250)'));

console.log(failed ? `\n✗ ${failed} failed` : '\n✓ tax income slider: all checks passed');
process.exit(failed ? 1 : 0);
