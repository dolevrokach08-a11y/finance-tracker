// Regression guard for the tax optimizer's two independent Firestore inputs.
// Finance owns payslips/transactions. Portfolio holdings, lots and current FX
// must come from users/{uid}/portfolio/data even if portfolio.html was not opened.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'tax-optimizer.html'), 'utf8');

let failed = 0;
const check = (label, condition) => {
  if (!condition) failed++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`);
};

check('finance is read from its own document',
  src.includes("doc(db, 'users', user.uid, 'finance', 'data')"));
check('portfolio is read independently from its own document',
  src.includes("getDoc(doc(db, 'users', user.uid, 'portfolio', 'data'))"));

const financeStart = src.indexOf('// Load finance data from Firebase');
const portfolioStart = src.indexOf('// Portfolio is a separate Firestore document');
const settingsStart = src.indexOf('// Load saved tax optimizer settings');
check('all three bootstrap sections are present in order',
  financeStart >= 0 && portfolioStart > financeStart && settingsStart > portfolioStart);

const financeBlock = src.slice(financeStart, portfolioStart);
const portfolioBlock = src.slice(portfolioStart, settingsStart);
check('finance data never populates portfolio globals',
  !financeBlock.includes('window.__portfolio'));
check('portfolio snapshot populates holdings, purchases, sales and rates',
  ['holdings', 'purchases', 'sales', 'rates'].every(key =>
    portfolioBlock.includes(`portfolioData.${key}`)));
check('failed and empty portfolio reads remain distinguishable',
  portfolioBlock.includes('window.__portfolioLoadError = true') &&
  portfolioBlock.includes('window.__portfolioLoadError = false'));
check('the bootstrap contains no invented legacy FX fallback',
  !src.includes('USD: 3.6') && !src.includes('EUR: 3.9'));
check('missing rates remain missing',
  portfolioBlock.includes('portfolioData.rates || {}') &&
  portfolioBlock.includes('window.__portfolioRates = {}'));

console.log(failed ? `\n✗ ${failed} failed` : '\n✓ tax portfolio source: all checks passed');
process.exit(failed ? 1 : 0);
