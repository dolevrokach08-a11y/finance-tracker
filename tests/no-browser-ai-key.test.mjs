/**
 * The Anthropic key must not be reachable from the browser — not stored, not
 * sent, and not accepted back.
 *
 * Two halves, because either alone passes on a broken version:
 *   - a static sweep of everything that ships to the browser, which catches a
 *     new direct call before it is ever wired up;
 *   - the actual behaviour of the two callers that used to hold a key —
 *     finance.html's category classifier, and UserStorage's purge.
 *
 *   node tests/no-browser-ai-key.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const repoDir = fileURLToPath(new URL('../', import.meta.url));
// Line endings are normalised: the repo is checked out CRLF on Windows and LF
// in CI, and a pattern that spans lines must not depend on which one ran.
const read = rel => readFileSync(path.join(repoDir, rel), 'utf8').replace(/\r\n/g, '\n');

// ── 1. Nothing that ships to the browser talks to Anthropic ─────────────────
// worker/ is the server and is the one place the key is allowed to exist;
// tests/ and agents/ describe the rule rather than break it.
const SKIP_DIRS = new Set(['node_modules', '.git', 'worker', 'tests', 'agents', 'docs', 'tools', 'design', '.github']);
const CLIENT_EXT = new Set(['.js', '.html', '.jsx', '.mjs', '.css']);

function clientFiles(dir = repoDir, prefix = '') {
    const out = [];
    for (const entry of readdirSync(dir)) {
        if (SKIP_DIRS.has(entry) || entry.startsWith('.')) continue;
        const full = path.join(dir, entry);
        const rel = prefix ? `${prefix}/${entry}` : entry;
        if (statSync(full).isDirectory()) out.push(...clientFiles(full, rel));
        else if (CLIENT_EXT.has(path.extname(entry))) out.push(rel);
    }
    return out;
}

const files = clientFiles();
assert.ok(files.includes('ai-assistant.js') && files.includes('finance.html'),
    'the sweep must actually be looking at the files that used to hold the key');

const BANNED = [
    // The endpoint itself. `sw.js` mentioning it in a comment is the reason this
    // matches a call rather than the bare hostname.
    { re: /https:\/\/api\.anthropic\.com/g, what: 'a direct call to api.anthropic.com' },
    { re: /anthropic-dangerous-direct-browser-access/g, what: 'the direct-browser-access header' },
    { re: /['"]x-api-key['"]/g, what: 'an x-api-key header' },
    { re: /ai_api_key/g, what: 'the retired ai_api_key storage key' },
    { re: /sk-ant-/g, what: 'an Anthropic key prefix' },
];

const violations = [];
for (const rel of files) {
    // user-storage.js names the retired key on purpose — it is the thing doing
    // the deleting. Anywhere else, naming it means touching it.
    const allowRetiredName = rel === 'shared/user-storage.js';
    const source = read(rel);
    for (const { re, what } of BANNED) {
        if (allowRetiredName && re.source.includes('ai_api_key')) continue;
        re.lastIndex = 0;
        if (re.test(source)) violations.push(`${rel}: ${what}`);
    }
}
assert.deepEqual(violations, [], 'client code must not reach Anthropic directly:\n' + violations.join('\n'));

// The Worker still has to be the one place that does.
assert.match(read('worker/worker.js'), /https:\/\/api\.anthropic\.com/,
    'the Worker is the only caller — if this is gone, the feature is gone');

// ── 2. UserStorage purges the retired key without reading it ────────────────
class MemoryStorage {
    constructor(seed = {}) { this.map = new Map(Object.entries(seed)); this.reads = []; }
    get length() { return this.map.size; }
    key(i) { return Array.from(this.map.keys())[i] ?? null; }
    getItem(k) { this.reads.push(String(k)); return this.map.has(String(k)) ? this.map.get(String(k)) : null; }
    setItem(k, v) { this.map.set(String(k), String(v)); }
    removeItem(k) { this.map.delete(String(k)); }
}

{
    const store = new MemoryStorage({
        ai_api_key: 'sk-ant-api03-must-never-be-read',
        'u::real-user-1::ai_api_key': 'sk-ant-api03-archived-copy',
        'u::demo-user-readonly::ai_api_key': 'sk-ant-api03-demo-copy',
        portfolio: '{"kept":true}',
        'u::real-user-1::portfolio': '{"kept":true}',
        ai_model: 'claude-sonnet-4-6',
        // A key that merely ends in something similar must survive.
        my_ai_api_keyring: 'keep me',
    });

    const sandbox = {
        window: {}, localStorage: store, navigator: { userAgent: 'purge test' },
        console: { warn() {}, log() {} }, Math, Date,
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(read('shared/user-storage.js'), sandbox, { filename: 'user-storage.js' });

    const US = sandbox.window.UserStorage;
    assert.ok(!US.USER_KEYS.includes('ai_api_key'), 'the retired key must be out of USER_KEYS');

    assert.equal(store.map.has('ai_api_key'), false, 'the plain key must be gone on load');
    assert.equal(store.map.has('u::real-user-1::ai_api_key'), false, 'archived copies must go too');
    assert.equal(store.map.has('u::demo-user-readonly::ai_api_key'), false);
    assert.equal(store.map.get('portfolio'), '{"kept":true}', 'nothing else may be touched');
    assert.equal(store.map.get('u::real-user-1::portfolio'), '{"kept":true}');
    assert.equal(store.map.get('my_ai_api_keyring'), 'keep me', 'suffix matching must not be a substring match');

    // "Do not read the value" is the actual requirement — a purge that reads it
    // first has already put the secret on the stack of whatever is watching.
    assert.ok(!store.reads.some(k => k.endsWith('ai_api_key')),
        'the purge must never call getItem on a retired key');

    // A user swap must not resurrect it.
    store.setItem('u::real-user-2::ai_api_key', 'sk-ant-api03-late-arrival');
    US.syncToUser('real-user-2');
    assert.equal(store.map.get('ai_api_key'), undefined,
        'restoring a user must not copy a retired key back into the plain slot');
}

// ── 3. finance.html's classifier goes to the Worker, with a token ───────────
{
    const html = read('finance.html');
    const fn = /async function suggestCategoriesWithClaude\([\s\S]*?\n        \}\n/.exec(html);
    assert.ok(fn, 'suggestCategoriesWithClaude must still be findable in finance.html');

    async function run({ token, workerReply }) {
        const calls = [];
        const sandbox = {
            console: { warn() {}, log() {} },
            JSON, Set, Object, String, Number, Promise,
            window: { FTData: { aiApi: () => 'https://finance-proxy.example/api/ai/chat' } },
            async pendingAuthHeaders(extra = {}) {
                return token ? { ...extra, Authorization: `Bearer ${token}` } : null;
            },
            async fetch(url, init) {
                calls.push({ url, init });
                return workerReply();
            },
        };
        sandbox.globalThis = sandbox;
        vm.createContext(sandbox);
        vm.runInContext(fn[0] + '\nglobalThis.__fn = suggestCategoriesWithClaude;', sandbox);
        const result = await sandbox.__fn(['בית קפה'], ['מזון', 'אחר'], []);
        return { result, calls };
    }

    const ok = () => ({
        ok: true,
        json: async () => ({ text: '{"בית קפה":"מזון"}', model: 'claude-haiku-4-5', usage: {} }),
    });

    const signedIn = await run({ token: 'firebase-id-token', workerReply: ok });
    assert.equal(signedIn.calls.length, 1);
    assert.equal(signedIn.calls[0].url, 'https://finance-proxy.example/api/ai/chat',
        'the classifier must call the Worker, not Anthropic');
    assert.equal(signedIn.calls[0].init.headers.Authorization, 'Bearer firebase-id-token');
    assert.equal(signedIn.calls[0].init.headers['x-api-key'], undefined);
    assert.deepEqual(signedIn.result, { 'בית קפה': 'מזון' },
        'the Worker returns {text}, not Anthropic content blocks');

    // `{}` built inside the vm has that realm's prototype, so count the keys
    // rather than compare against an object from this one.
    const signedOut = await run({ token: null, workerReply: ok });
    assert.equal(signedOut.calls.length, 0, 'no token means no request at all');
    assert.equal(Object.keys(signedOut.result).length, 0, 'and the import continues with Max categories');

    const notAllowed = await run({
        token: 'firebase-id-token',
        workerReply: () => ({ ok: false, status: 403, json: async () => ({ error: 'ai_not_enabled_for_user' }) }),
    });
    assert.equal(Object.keys(notAllowed.result).length, 0,
        'a refused account must not break the import — and has nothing to fall back to');
}

console.log('✓ no browser ai key: static sweep, purge, and both callers');
