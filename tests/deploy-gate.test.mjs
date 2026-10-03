/**
 * The two halves of the deploy gate.
 *
 * 1. A shell change with no SHELL_CACHE bump must FAIL, not warn. It was a
 *    `::warning` in checks.yml, and a warning does not stop a merge.
 * 2. Activating a new worker must delete only THIS app's caches. github.io
 *    puts every project a user publishes on one origin, so "a cache name I do
 *    not recognise" is someone else's data, not garbage.
 *
 * The service worker is executed here rather than read as text: the assertion
 * is about what activate actually deletes, and a regex over the source would
 * pass on a version that looks right and behaves wrong.
 *
 *   node tests/deploy-gate.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const repo = new URL('../', import.meta.url);
const read = rel => readFileSync(fileURLToPath(new URL(rel, repo)), 'utf8');

const { shellBumpVerdict, isShellPath } = await import('../tools/check-shell-bump.mjs');

// ── 1. The bump gate ────────────────────────────────────────────────────────
const swAt = name => `const SHELL_CACHE = '${name}';\nconst VENDOR_CACHE = 'finance-tracker-vendor-v1';\n`;

{
    // The exact shape this gate exists for: a shell file edited, cache name left alone.
    const v = shellBumpVerdict({
        changed: ['finance.html', 'shared/user-storage.js'],
        baseSw: swAt('finance-tracker-v49'),
        headSw: swAt('finance-tracker-v49'),
    });
    assert.equal(v.ok, false, 'a shell change with no bump must fail the gate');
    assert.match(v.reason, /finance-tracker-v49/);
    assert.deepEqual(v.shellChanged, ['finance.html', 'shared/user-storage.js']);
}

{
    const v = shellBumpVerdict({
        changed: ['finance.html'],
        baseSw: swAt('finance-tracker-v49'),
        headSw: swAt('finance-tracker-v50'),
    });
    assert.equal(v.ok, true, 'a bumped cache name lets the same change through');
}

{
    // Nothing the browser loads changed, so no bump is owed.
    const v = shellBumpVerdict({
        changed: ['tests/deploy-gate.test.mjs', 'agents/from-gpt/note.md', 'worker/worker.js',
                  'tools/check-shell-bump.mjs', 'data/boi-mortgage-rates.json'],
        baseSw: swAt('finance-tracker-v49'),
        headSw: swAt('finance-tracker-v49'),
    });
    assert.equal(v.ok, true, 'non-shell paths must not demand a bump');
    assert.deepEqual(v.shellChanged, []);
}

{
    // Knowing least is not a reason to pass.
    const v = shellBumpVerdict({ changed: ['app/main.js'], baseSw: '', headSw: swAt('finance-tracker-v49') });
    assert.equal(v.ok, false, 'an unreadable base must fail closed');
}

assert.ok(isShellPath('app/modules/home/home.js'));
assert.ok(isShellPath('mortgage.html'));
assert.ok(isShellPath('ai-assistant.js'));
assert.ok(!isShellPath('sw.js'), 'editing sw.js is how you bump — it cannot require a bump');
assert.ok(!isShellPath('tools/build-assets.mjs'));

// The repo's own sw.js has to be readable by the gate, or the gate is a no-op.
assert.ok(shellBumpVerdict({ changed: [], baseSw: read('sw.js'), headSw: read('sw.js') }).to,
    'SHELL_CACHE must be parseable out of the real sw.js');

// ── 2. activate() deletes only our caches ───────────────────────────────────
function runServiceWorker(source, cacheNames) {
    const listeners = {};
    const deleted = [];
    const sandbox = {
        console: { log() {}, warn() {}, error() {} },
        URL, Request, Response, Promise, Set, Map, fetch: async () => new Response(''),
        setTimeout, clearTimeout,
        caches: {
            keys: async () => cacheNames.slice(),
            delete: async name => { deleted.push(name); return true; },
            open: async () => ({ put: async () => {}, match: async () => undefined }),
            match: async () => undefined,
        },
    };
    sandbox.self = {
        addEventListener: (type, fn) => { listeners[type] = fn; },
        registration: { scope: 'https://user.github.io/finance-tracker/' },
        location: { origin: 'https://user.github.io' },
        skipWaiting: async () => {},
        clients: { claim: async () => {} },
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, { filename: 'sw.js' });
    return { listeners, deleted };
}

{
    // Read the live name, so the next SHELL_CACHE bump does not break this test.
    const current = shellBumpVerdict({ changed: [], baseSw: read('sw.js'), headSw: read('sw.js') }).to;
    const { listeners, deleted } = runServiceWorker(read('sw.js'), [
        'finance-tracker-v1',             // an older shell — ours, superseded
        current,                          // the current shell
        'finance-tracker-vendor-v1',      // ours, kept across bumps
        'my-other-project-v3',            // a different app on the same github.io origin
        'workbox-precache-v2-https://user.github.io/blog/',
        'keyval-store',
    ]);

    assert.ok(listeners.activate, 'sw.js must register an activate handler');
    const waits = [];
    await listeners.activate({ waitUntil: p => waits.push(p) });
    await Promise.all(waits);

    assert.deepEqual(deleted, ['finance-tracker-v1'],
        'activate must purge only our superseded cache — everything else on the origin belongs to someone else');
}

console.log('✓ deploy gate: bump enforced, cache purge scoped');
