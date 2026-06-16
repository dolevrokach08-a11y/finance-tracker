/**
 * Max scraper — PHASE 2a: cloud validation (de-risk only)
 * ------------------------------------------------------------------
 * Runs inside GitHub Actions to answer the LAST open question:
 *   does Max trigger an OTP step-up from a datacenter IP (which the
 *   local machine did not)?
 *
 * This phase only logs the transaction count — it does NOT post to the
 * Worker yet. Once we confirm the cloud login works without OTP, phase 2b
 * adds dedup_key + category mapping + the POST to /api/transactions/pending.
 *
 * Credentials come from GitHub Actions secrets (env vars), never hardcoded.
 */

import { CompanyTypes, createScraper } from 'israeli-bank-scrapers';

const username = process.env.MAX_USERNAME;
const password = process.env.MAX_PASSWORD;

if (!username || !password) {
  console.error('[X] Missing MAX_USERNAME / MAX_PASSWORD secrets.');
  process.exit(1);
}

// ~60 days back — enough to see real transactions.
const startDate = new Date();
startDate.setDate(startDate.getDate() - 60);

const scraper = createScraper({
  companyId: CompanyTypes.max,
  startDate,
  combineInstallments: false,
  // Headless (default). npm install pulls Chromium; --no-sandbox is required
  // for Chromium to launch on a GitHub Actions Ubuntu runner.
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
  verbose: true,
});

console.log('[..] Connecting to Max from the GitHub Actions runner, since',
  startDate.toISOString().slice(0, 10), '...');

try {
  const result = await scraper.scrape({ username, password });

  if (!result.success) {
    console.error('[X] Scrape FAILED.');
    console.error('    errorType   :', result.errorType);
    console.error('    errorMessage:', result.errorMessage);
    console.error('    => If this points to 2FA/OTP, the datacenter IP triggered a');
    console.error('       step-up. We then switch to a long-term token or local run.');
    process.exit(2);
  }

  const txns = result.accounts.flatMap(a => a.txns);
  console.log('\n[OK] Success from the cloud runner!');
  console.log('     accounts    :', result.accounts.length);
  console.log('     transactions:', txns.length);
  result.accounts.forEach(a =>
    console.log('     - card', a.accountNumber, ':', a.txns.length, 'txns'));
  console.log('\n[CONCLUSION] No OTP step-up from the cloud IP — full headless');
  console.log('             automation is viable. Ready for phase 2b.');
} catch (err) {
  console.error('\n[!!] Unexpected exception:', err.message);
  process.exit(3);
}
