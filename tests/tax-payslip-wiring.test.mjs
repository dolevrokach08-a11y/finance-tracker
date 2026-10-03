import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'tax-optimizer.html'), 'utf8');
const jsx = readFileSync(join(ROOT, 'tax-optimizer.src.jsx'), 'utf8');

let failed = 0;
const check = (label, condition) => {
  if (!condition) failed++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`);
};

check('payslip queue loads before module bootstrap',
  html.indexOf('shared/payslip-sync.js') < html.indexOf('<script type="module">'));
check('tax bootstrap imports the demo-gated transaction wrapper',
  html.includes('runTransaction = fb.runTransaction'));
check('save enqueues a durable upsert',
  html.includes('__payslipCoordinator?.enqueueAdd(payslip)'));
check('delete enqueues a durable delete',
  html.includes('__payslipCoordinator?.enqueueDelete(payslipId)'));
check('reconnect flushes the same queue',
  html.includes("addEventListener('online', window.__flushPayslipQueue)"));

const forceStart = html.indexOf('onForceSync: async () =>');
const forceEnd = html.indexOf('\n      }', forceStart);
const forceBlock = html.slice(forceStart, forceEnd);
check('force sync uses the queue flush contract',
  forceBlock.includes('window.__flushPayslipQueue'));
check('force sync does not write stale finance data wholesale',
  !forceBlock.includes('window.__financeData') && !forceBlock.includes('setDoc(window.__financeDocRef'));

check('all user-visible sync states have explicit Hebrew copy',
  ['stored-local', 'pending', 'syncing', 'cloud', 'conflict', 'error'].every(state =>
    jsx.includes(`status.state === '${state}'`)));
check('generated app will receive the source status handler',
  jsx.includes("addEventListener('payslipSyncStatusChanged'"));

console.log(failed ? `\n✗ ${failed} failed` : '\n✓ tax payslip wiring: all checks passed');
process.exit(failed ? 1 : 0);
