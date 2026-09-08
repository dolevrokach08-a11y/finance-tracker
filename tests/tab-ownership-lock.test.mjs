/**
 * Cross-tab ownership lock (AGENTS.md Batch 0c intermediate boundary).
 *
 * The plain localStorage keys are one shared slot per origin. Two tabs open at
 * once — a real account and a demo session, or two real accounts on a shared
 * machine — race for that slot: whichever tab last called syncToUser() /
 * enterDemoSandbox() owns it, and the OTHER tab has no idea that just
 * happened. Before this fix, that other tab would go on reading and writing
 * the plain keys as if they were still its own — mixing a real account's data
 * into what a demo tab then displays, or overwriting a fresh account swap with
 * stale data from memory.
 *
 * The browser tells every OTHER tab about a localStorage change via the
 * `storage` event (it never fires in the tab that made the change). This test
 * fires that event manually — exactly the payload a browser would deliver —
 * and checks that the tab receiving it locks itself out of the plain keys
 * rather than continuing to use them.
 *
 * Each simulated "tab" gets its own `Storage` class, not a shared one: real
 * tabs are separate JS realms, each with its own `Storage.prototype`, even
 * though the underlying storage is the same origin. Sharing one class between
 * two `makeTab()` calls here would make the second tab's module skip patching
 * (the guard flag is already set) and silently run on the first tab's guard
 * state — a test-harness bug that would hide exactly the thing under test.
 *
 *   node tests/tab-ownership-lock.test.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const repoDir = fileURLToPath(new URL('../', import.meta.url));
const read = rel => readFileSync(path.join(repoDir, rel), 'utf8').replace(/\r\n/g, '\n');
const userStorageSrc = read('shared/user-storage.js');

// A DOM stub just capable enough for the banner: a body that records appended
// elements, findable by id, without parsing the innerHTML string it carries
// (real content, not a template the test needs to inspect).
function makeFakeDocument() {
    const body = {
        children: [],
        appendChild(el) { el.parentNode = body; body.children.push(el); },
        removeChild(el) {
            const i = body.children.indexOf(el);
            if (i >= 0) body.children.splice(i, 1);
            el.parentNode = null;
        },
    };
    return {
        body,
        createElement() {
            return { style: {}, setAttribute() {}, addEventListener() {}, parentNode: null };
        },
        getElementById(id) { return body.children.find(c => c.id === id) || null; },
    };
}

function makeTab() {
    // A fresh class per tab: see the file header for why this must not be shared.
    class TabStorage {
        constructor() { this._map = new Map(); }
        get length() { return this._map.size; }
        key(i) { return Array.from(this._map.keys())[i] ?? null; }
        getItem(k) { return this._map.has(String(k)) ? this._map.get(String(k)) : null; }
        setItem(k, v) { this._map.set(String(k), String(v)); }
        removeItem(k) { this._map.delete(String(k)); }
    }
    const listeners = [];
    const store = new TabStorage();
    const sandbox = {
        Storage: TabStorage,
        localStorage: store,
        navigator: { userAgent: 'ownership lock test' },
        console: { warn() {}, log() {} },
        window: {
            addEventListener(type, fn) { if (type === 'storage') listeners.push(fn); },
            location: { reload() {} },
        },
        document: makeFakeDocument(),
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(userStorageSrc, sandbox, { filename: 'user-storage.js' });
    return {
        UserStorage: sandbox.window.UserStorage,
        // Gated access — exactly what app code goes through.
        get: k => store.getItem(k),
        set: (k, v) => store.setItem(k, v),
        remove: k => store.removeItem(k),
        // Ground truth, bypassing the gate — what actually landed in storage.
        raw: k => store._map.has(k) ? store._map.get(k) : null,
        banner: () => sandbox.document.getElementById('ft-ownership-lock-banner'),
        // What a browser delivers to every OTHER tab when localStorage changes.
        // The underlying store is the same physical origin storage in a real
        // browser — only the JS realm (and so Storage.prototype) differs per
        // tab — so the value is really there by the time the event arrives,
        // and the mock has to put it there too.
        deliverForeignChange(key, newValue) {
            if (newValue === null) store._map.delete(key); else store._map.set(key, newValue);
            listeners.forEach(fn => fn({ key, newValue }));
        },
    };
}

let failures = 0;
const ok = (cond, name, got = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  got: ${got}`}`);
    if (!cond) failures++;
};

// ── A tab that never loses ownership behaves exactly as before ──────────────
{
    const tab = makeTab();
    tab.UserStorage.syncToUser('user-a');
    tab.set('financeTrackerData', '{"real":true}');
    ok(tab.get('financeTrackerData') === '{"real":true}',
        'an owning tab reads/writes the plain keys normally');
    ok(tab.banner() === null, 'no banner while this tab still owns the keys');
}

// ── Another tab taking the plain keys locks this one out ────────────────────
{
    const tab = makeTab();
    tab.UserStorage.syncToUser('user-a');
    tab.set('financeTrackerData', '{"real":true}');

    // Tab B calls enterDemoSandbox() elsewhere; the browser delivers this to
    // every other tab, including this one.
    tab.deliverForeignChange('ft_active_uid', 'demo-user-readonly');

    ok(tab.banner() !== null, 'losing ownership shows the lockout banner');
    ok(tab.get('financeTrackerData') === null,
        'a locked-out tab can no longer read the plain keys it used to own');

    tab.set('financeTrackerData', '{"leaked":true}');
    ok(tab.raw('financeTrackerData') === '{"real":true}',
        'a locked-out tab\'s write is dropped — it must not overwrite the new owner\'s data',
        tab.raw('financeTrackerData'));

    ok(tab.get('ft_active_uid') === 'demo-user-readonly',
        'ACTIVE_KEY itself stays readable — the lock only gates USER_KEYS');
}

// ── Recovery: this same tab re-authenticating clears the lock ───────────────
{
    const tab = makeTab();
    tab.UserStorage.syncToUser('user-a');
    tab.deliverForeignChange('ft_active_uid', 'demo-user-readonly');
    ok(tab.get('financeTrackerData') === null, 'locked out after losing ownership');

    // The user signs back in, in this same tab — a deliberate reclaim, not an
    // automatic reseed hiding the problem.
    tab.UserStorage.syncToUser('user-a');
    ok(tab.banner() === null, 'reclaiming ownership removes the banner');
    tab.set('financeTrackerData', '{"back":true}');
    ok(tab.get('financeTrackerData') === '{"back":true}',
        'reads and writes work normally again after reclaiming ownership');

    // And it can be locked out again afterwards — recovery must reset state,
    // not just permanently disarm the guard.
    tab.deliverForeignChange('ft_active_uid', 'someone-else');
    ok(tab.get('financeTrackerData') === null,
        'the tab can be locked out again after a recovery — this is not a one-shot check');
}

// ── A tab that already agrees on the owner does not lock itself out ─────────
{
    const tab = makeTab();
    tab.UserStorage.syncToUser('user-a');
    // The "storage" event never fires in the tab that made the change — this
    // models a benign notification for a value this tab already knows.
    tab.deliverForeignChange('ft_active_uid', 'user-a');
    ok(tab.banner() === null, 'an event confirming the owner this tab already has is not a takeover');
}

if (failures) {
    console.error(`${failures} failure(s)`);
    process.exit(1);
}
console.log('✓ tab ownership lock: a tab that loses the plain keys stops reading and writing them');
