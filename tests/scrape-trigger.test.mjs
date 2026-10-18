/**
 * The "scan Max now" route starts a workflow that logs into the card company
 * with real credentials, so who may start it, and how often, is worth testing.
 *
 * Same approach as ai-endpoint.test.mjs: Google's signing keys are swapped for
 * a keypair generated here, so tokens go through the Worker's real RS256 check,
 * and api.github.com is stubbed so the test can see exactly what was sent.
 *
 *   node tests/scrape-trigger.test.mjs
 */
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

const subtle = webcrypto.subtle;
const PROJECT_ID = 'finance-tracker-21e18';
const KID = 'test-signing-key';
const UID = 'scrape-owner-1';
const ORIGIN = 'https://dolevrokach08-a11y.github.io';
const BASE = 'https://finance-proxy.example/api/scrape';
const GH_TOKEN = 'github_pat_secret_that_must_never_leak';

const rsaParams = {
    name: 'RSASSA-PKCS1-v1_5',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256',
};
const pair = await subtle.generateKey(rsaParams, true, ['sign', 'verify']);
const publicJwk = await subtle.exportKey('jwk', pair.publicKey);
publicJwk.kid = KID;
publicJwk.alg = 'RS256';
publicJwk.use = 'sig';
const impostor = await subtle.generateKey(rsaParams, true, ['sign', 'verify']);

const b64url = bytes => Buffer.from(bytes).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const segment = obj => b64url(new TextEncoder().encode(JSON.stringify(obj)));

async function mintToken({ signWith = pair.privateKey, ...claims } = {}) {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', kid: KID, typ: 'JWT' };
    const payload = {
        aud: PROJECT_ID,
        iss: `https://securetoken.google.com/${PROJECT_ID}`,
        sub: UID,
        iat: now - 10,
        exp: now + 3600,
        ...claims,
    };
    const signingInput = `${segment(header)}.${segment(payload)}`;
    const signature = await subtle.sign(
        'RSASSA-PKCS1-v1_5', signWith, new TextEncoder().encode(signingInput));
    return `${signingInput}.${b64url(new Uint8Array(signature))}`;
}

// ── Stub GitHub ─────────────────────────────────────────────────────────────
let ghCalls = [];
let ghRuns = [];                 // what the runs list returns
let ghListStatus = 200;
let ghDispatchStatus = 204;

const ghRun = (over = {}) => ({
    id: 1, status: 'completed', conclusion: 'success', event: 'schedule',
    created_at: new Date(Date.now() - 6 * 3600e3).toISOString(),
    updated_at: new Date(Date.now() - 6 * 3600e3 + 180e3).toISOString(),
    html_url: 'https://github.com/dolevrokach08-a11y/finance-scraper/actions/runs/1',
    // Fields the page has no business seeing.
    head_commit: { message: 'secret-ish commit message' },
    actor: { login: 'someone' },
    ...over,
});

globalThis.fetch = async (url, init = {}) => {
    const href = typeof url === 'string' ? url : url.url;
    if (href.includes('securetoken@system.gserviceaccount.com')) {
        return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 });
    }
    if (href.startsWith('https://api.github.com/')) {
        ghCalls.push({ href, init });
        if (href.includes('/dispatches')) return new Response(null, { status: ghDispatchStatus });
        if (href.includes('/runs')) {
            return new Response(JSON.stringify({ total_count: ghRuns.length, workflow_runs: ghRuns }),
                { status: ghListStatus });
        }
    }
    throw new Error('unexpected fetch: ' + href);
};

const { default: worker } = await import('../worker/worker.js');

const ENV = {
    GITHUB_DISPATCH_TOKEN: GH_TOKEN,
    SCRAPE_ALLOWED_UIDS: UID,
    FIREBASE_PROJECT_ID: PROJECT_ID,
};

async function call(route, { token, method, origin = ORIGIN } = {}, env = ENV) {
    ghCalls = [];
    method = method || (route === 'run' ? 'POST' : 'GET');
    const response = await worker.fetch(new Request(`${BASE}/${route}`, {
        method,
        headers: {
            ...(origin ? { Origin: origin } : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
    }), env);
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON */ }
    return { status: response.status, json, text };
}
const dispatches = () => ghCalls.filter(c => c.href.includes('/dispatches'));

// ── 1. Not configured: 503, GitHub never called ─────────────────────────────
{
    const token = await mintToken();
    const r = await call('run', { token }, { ...ENV, GITHUB_DISPATCH_TOKEN: '' });
    assert.equal(r.status, 503);
    assert.equal(r.json.error, 'scrape_not_configured');
    assert.equal(ghCalls.length, 0);
}

// ── 2. The gates in front of a login to the card company ────────────────────
{
    let r = await call('run', {});
    assert.equal(r.status, 401, 'no token');

    r = await call('run', { token: await mintToken({ signWith: impostor.privateKey }) });
    assert.equal(r.status, 401, 'forged token');

    const now = Math.floor(Date.now() / 1000);
    r = await call('run', { token: await mintToken({ iat: now - 7200, exp: now - 60 }) });
    assert.equal(r.status, 401, 'expired token');

    r = await call('run', { token: await mintToken({ sub: 'some-other-google-account' }) });
    assert.equal(r.status, 403, 'signed in is not permission');
    assert.equal(r.json.error, 'scrape_not_enabled_for_user');

    r = await call('run', { token: await mintToken() }, { ...ENV, SCRAPE_ALLOWED_UIDS: undefined });
    assert.equal(r.status, 403, 'an unset allowlist fails closed');

    r = await call('run', { token: await mintToken(), origin: null });
    assert.equal(r.status, 403, 'no Origin = not our page');

    r = await call('run', { token: await mintToken(), origin: 'https://evil.example' });
    assert.equal(r.status, 403, 'foreign Origin');

    r = await call('run', { token: await mintToken(), method: 'GET' });
    assert.equal(r.status, 405, 'run is POST only');

    assert.equal(ghCalls.length, 0, 'nothing above reached GitHub');
}

// ── 3. A run already queued or running is followed, not doubled ─────────────
{
    ghRuns = [ghRun({ id: 77, status: 'in_progress', conclusion: null, event: 'schedule',
        created_at: new Date(Date.now() - 60e3).toISOString() })];
    const r = await call('run', { token: await mintToken() });
    assert.equal(r.status, 409);
    assert.equal(r.json.error, 'already_running');
    assert.equal(r.json.run.id, 77);
    assert.equal(dispatches().length, 0);
}

// ── 4. Cooldown is read from GitHub, so it holds across isolates ────────────
{
    ghRuns = [ghRun({ id: 78, created_at: new Date(Date.now() - 3 * 60e3).toISOString() })];
    const r = await call('run', { token: await mintToken() });
    assert.equal(r.status, 429);
    assert.equal(r.json.error, 'cooldown');
    assert.ok(r.json.retryAfterSec > 6 * 60 && r.json.retryAfterSec <= 7 * 60, 'about 7 minutes left');
    assert.equal(dispatches().length, 0);
}

// ── 5. GitHub failing is a 502, never a 401 that looks like a sign-out ──────
{
    ghListStatus = 401;
    const r = await call('run', { token: await mintToken() });
    assert.equal(r.status, 502);
    assert.equal(r.json.upstreamStatus, 401);
    assert.equal(dispatches().length, 0);
    ghListStatus = 200;
}

// ── 6. Status: only the fields the page needs ───────────────────────────────
{
    ghRuns = [ghRun({ id: 90 })];
    const r = await call('status', { token: await mintToken() });
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.json.run).sort(),
        ['conclusion', 'createdAt', 'event', 'id', 'status', 'updatedAt', 'url']);
    assert.ok(!r.text.includes('secret-ish'));
    assert.equal(dispatches().length, 0, 'status never starts a run');

    const denied = await call('status', { token: await mintToken({ sub: 'stranger' }) });
    assert.equal(denied.status, 403, 'status is gated too');
}

// ── 7. Status prefers a run in progress over a newer finished one ───────────
{
    ghRuns = [ghRun({ id: 92 }), ghRun({ id: 91, status: 'queued', conclusion: null })];
    const r = await call('status', { token: await mintToken() });
    assert.equal(r.json.run.id, 91);
}

// ── 8. The happy path, and exactly what goes to GitHub ──────────────────────
{
    ghRuns = [ghRun()]; // last night's run, six hours ago
    const r = await call('run', { token: await mintToken() });
    assert.equal(r.status, 202);
    assert.ok(!Number.isNaN(Date.parse(r.json.dispatchedAt)));

    const sent = dispatches();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].href,
        'https://api.github.com/repos/dolevrokach08-a11y/finance-scraper/actions/workflows/scraper.yml/dispatches');
    assert.equal(sent[0].init.method, 'POST');
    assert.deepEqual(JSON.parse(sent[0].init.body), { ref: 'main' });
    assert.equal(sent[0].init.headers.Authorization, `Bearer ${GH_TOKEN}`);
    assert.ok(sent[0].init.headers['User-Agent'], 'GitHub rejects calls without a User-Agent');
    assert.ok(!r.text.includes(GH_TOKEN), 'the GitHub token never comes back out');
}

// ── 9. A double-click: the new run is not in GitHub's list yet ──────────────
{
    ghRuns = [ghRun()];
    const r = await call('run', { token: await mintToken() });
    assert.equal(r.status, 429, 'the dispatch stamp covers the gap before the run shows up');
    assert.equal(dispatches().length, 0);
}

// ── 10. A failed dispatch is a 502 ──────────────────────────────────────────
// Run in a fresh isolate, since the stamp from test 8 still holds in this one.
{
    const { default: fresh } = await import('../worker/worker.js?fresh');
    ghRuns = [ghRun()];
    ghDispatchStatus = 422;
    ghCalls = [];
    const response = await fresh.fetch(new Request(`${BASE}/run`, {
        method: 'POST',
        headers: { Origin: ORIGIN, Authorization: `Bearer ${await mintToken()}` },
    }), ENV);
    assert.equal(response.status, 502);
    assert.equal((await response.json()).upstreamStatus, 422);
    ghDispatchStatus = 204;
}

console.log('scrape-trigger: all checks passed');
