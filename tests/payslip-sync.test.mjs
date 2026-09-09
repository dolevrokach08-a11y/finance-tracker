import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(ROOT, 'shared', 'payslip-sync.js'), 'utf8');
const context = { console, Date, Math, JSON, Set };
context.globalThis = context;
vm.runInNewContext(source, context);
const Sync = context.PayslipSync;

const clone = value => JSON.parse(JSON.stringify(value));
const storage = initial => {
  const map = new Map(Object.entries(initial || {}));
  return {
    getItem: key => map.has(key) ? map.get(key) : null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key),
    map
  };
};

function fakeCloud(initial, options = {}) {
  let remote = clone(initial);
  let calls = 0;
  let throwAfterCommit = !!options.throwAfterCommit;
  return {
    transact: async callback => {
      calls++;
      let patch = null;
      const result = await callback({
        get: async () => clone(remote),
        set: value => { patch = clone(value); }
      });
      if (patch) remote = { ...remote, ...patch };
      if (throwAfterCommit) {
        throwAfterCommit = false;
        throw new Error('ambiguous disconnect');
      }
      return result;
    },
    remote: () => clone(remote),
    calls: () => calls
  };
}

let failures = 0;
const check = (label, condition) => {
  if (!condition) failures++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`);
};

check('queue key is managed contract', Sync.QUEUE_KEY === 'tax_pending_payslip_ops');

// Offline add survives a fresh coordinator and merges with a newer remote row.
{
  const local = storage();
  let id = 0;
  const ids = () => `id-${++id}`;
  const first = Sync.create({ storage: local, makeId: ids });
  const saved = first.enqueueAdd({ month: '2026-08', earner: 'father', source: 'pdf', fileName: 'a.pdf', gross: 100 });
  check('offline add receives stable payslip id', saved.id === 'p-id-1');
  check('offline add is persisted before reload', first.pendingCount() === 1);

  const cloud = fakeCloud({ payslips: [{ id: 'remote-new', month: '2026-09' }], sibling: 'kept' });
  const statuses = [];
  const reloaded = Sync.create({ storage: local, transact: cloud.transact, makeId: ids, now: () => new Date('2026-09-09T12:00:00Z'), onStatus: s => statuses.push(s) });
  check('reload projects pending row', reloaded.project(cloud.remote().payslips).some(p => p.id === saved.id));
  check('reconnect flush succeeds', await reloaded.flush());
  check('unrelated newer remote payslip survives', cloud.remote().payslips.some(p => p.id === 'remote-new'));
  check('queued add reaches cloud once', cloud.remote().payslips.filter(p => p.id === saved.id).length === 1);
  check('sibling finance fields survive merge patch', cloud.remote().sibling === 'kept');
  check('queue clears only after commit', reloaded.pendingCount() === 0);
  check('truthful status reaches cloud', statuses.at(-1)?.state === 'cloud' && statuses.at(-1)?.pendingCount === 0);
  await reloaded.flush();
  check('empty replay performs no second transaction', cloud.calls() === 1);
}

// An ambiguous response after commit retains the op; retry consults the ledger.
{
  const local = storage();
  let n = 0;
  const cloud = fakeCloud({ payslips: [] }, { throwAfterCommit: true });
  const sync = Sync.create({ storage: local, transact: cloud.transact, makeId: () => `amb-${++n}` });
  const saved = sync.enqueueAdd({ source: 'manual', gross: 200 });
  check('ambiguous failed response retains queue', !(await sync.flush()) && sync.pendingCount() === 1);
  check('retry succeeds', await sync.flush());
  check('idempotent retry does not duplicate payslip', cloud.remote().payslips.filter(p => p.id === saved.id).length === 1);
}

// Offline delete survives reload and removes only its target.
{
  const local = storage();
  const cloud = fakeCloud({ payslips: [{ id: 'delete-me' }, { id: 'keep-me' }] });
  Sync.create({ storage: local, makeId: () => 'delete-op' }).enqueueDelete('delete-me');
  const reloaded = Sync.create({ storage: local, transact: cloud.transact });
  check('offline delete survives reload projection', reloaded.project(cloud.remote().payslips).length === 1);
  check('offline delete reconnect succeeds', await reloaded.flush());
  check('delete preserves unrelated remote row', JSON.stringify(cloud.remote().payslips) === JSON.stringify([{ id: 'keep-me' }]));
}

// A real transaction failure is visible and never discards the durable op.
{
  const local = storage();
  const states = [];
  const sync = Sync.create({ storage: local, transact: async () => { throw new Error('offline'); }, onStatus: s => states.push(s), makeId: () => 'fail-op' });
  sync.enqueueAdd({ id: 'still-local', source: 'manual' });
  check('failed transaction returns false', !(await sync.flush()));
  check('failed transaction retains operation', sync.pendingCount() === 1);
  check('failed transaction exposes error status', states.at(-1)?.state === 'error');
}

// A new local edit made while an earlier flush is in flight must remain both
// durable and visible when that older transaction completes.
{
  const local = storage();
  let release;
  let transactionReady;
  const gate = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { transactionReady = resolve; });
  let remote = { payslips: [] };
  let latestProjection = [];
  let seq = 0;
  const transact = async callback => {
    let patch;
    const result = await callback({
      get: async () => clone(remote),
      set: value => { patch = clone(value); }
    });
    remote = { ...remote, ...patch };
    transactionReady();
    await gate;
    return result;
  };
  const sync = Sync.create({
    storage: local,
    transact,
    makeId: () => `race-${++seq}`,
    onProjection: rows => { latestProjection = rows; }
  });
  sync.enqueueAdd({ id: 'first', source: 'manual' });
  const flushing = sync.flush();
  await ready;
  sync.enqueueAdd({ id: 'during-flight', source: 'manual' });
  release();
  check('in-flight newer operation remains queued', await flushing && sync.pendingCount() === 1);
  check('in-flight newer operation remains visible', latestProjection.some(p => p.id === 'during-flight'));
  check('older transaction still committed its own row', latestProjection.some(p => p.id === 'first'));
}

const firebase = readFileSync(join(ROOT, 'firebase-config.js'), 'utf8');
const wrapperStart = firebase.indexOf('async function runTransaction(');
const wrapperEnd = firebase.indexOf('\n}', wrapperStart);
const wrapper = firebase.slice(wrapperStart, wrapperEnd + 2);
check('transaction wrapper blocks before invoking Firestore in demo',
  wrapper.indexOf('isDemoModeActive()') >= 0 &&
  wrapper.indexOf('isDemoModeActive()') < wrapper.indexOf('firestoreRunTransaction'));

console.log(failures ? `\n✗ ${failures} failed` : '\n✓ payslip sync: all checks passed');
process.exit(failures ? 1 : 0);
