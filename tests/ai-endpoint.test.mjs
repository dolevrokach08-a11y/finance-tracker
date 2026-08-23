/**
 * The AI endpoint spends real money, so its gate is worth testing for real.
 *
 * Google's signing keys are swapped for a keypair generated here, which lets
 * the test mint tokens that the Worker verifies through its actual RS256 path —
 * no shortcut around the check being tested. Anthropic is stubbed so the
 * assertions can look at exactly what would have been sent.
 *
 *   node tests/ai-endpoint.test.mjs
 */
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

const subtle = webcrypto.subtle;
const PROJECT_ID = 'finance-tracker-21e18';
const KID = 'test-signing-key';
const UID = 'allowed-user-1';
const ORIGIN = 'https://dolevrokach08-a11y.github.io';
const ENDPOINT = 'https://finance-proxy.example/api/ai/chat';

// ── Stand-in for Google's signing keys ──────────────────────────────────────
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

// A second keypair nobody published — used to forge a well-formed token.
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

// ── Stub the network the Worker reaches for ─────────────────────────────────
let upstreamCalls = [];
let upstreamReply = () => new Response(JSON.stringify({
    content: [{ type: 'text', text: 'תשובה מהמודל' }],
    usage: { input_tokens: 11, output_tokens: 22 },
}), { status: 200, headers: { 'Content-Type': 'application/json' } });

globalThis.fetch = async (url, init) => {
    const href = typeof url === 'string' ? url : url.url;
    if (href.includes('securetoken@system.gserviceaccount.com')) {
        return new Response(JSON.stringify({ keys: [publicJwk] }), {
            status: 200, headers: { 'Content-Type': 'application/json' },
        });
    }
    if (href.startsWith('https://api.anthropic.com/')) {
        upstreamCalls.push({ href, init });
        return upstreamReply();
    }
    throw new Error('unexpected fetch: ' + href);
};

const { default: worker } = await import('../worker/worker.js');

const ENV = {
    ANTHROPIC_API_KEY: 'sk-ant-secret-that-must-never-leak',
    AI_ALLOWED_UIDS: UID,
    FIREBASE_PROJECT_ID: PROJECT_ID,
};

function request(body, { token, method = 'POST' } = {}) {
    return new Request(ENDPOINT, {
        method,
        headers: {
            'Content-Type': 'application/json',
            'Origin': ORIGIN,
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
    });
}

const VALID_BODY = {
    model: 'claude-sonnet-4-6',
    system: 'system prompt',
    messages: [{ role: 'user', content: 'מה מצב התיק?' }],
};

async function call(body, opts, env = ENV) {
    upstreamCalls = [];
    const response = await worker.fetch(request(body, opts), env);
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON body */ }
    return { status: response.status, json, text };
}

// ── 1. No key configured: 503, and the client is free to fall back ──────────
{
    const r = await call(VALID_BODY, {}, { ...ENV, ANTHROPIC_API_KEY: '' });
    assert.equal(r.status, 503);
    assert.equal(r.json.error, 'ai_not_configured');
    assert.equal(upstreamCalls.length, 0);
}

// ── 2. No token: nothing is spent ───────────────────────────────────────────
{
    const r = await call(VALID_BODY, {});
    assert.equal(r.status, 401);
    assert.equal(upstreamCalls.length, 0);
}

// ── 3. A forged token — right shape, wrong signer ───────────────────────────
{
    const token = await mintToken({ signWith: impostor.privateKey });
    const r = await call(VALID_BODY, { token });
    assert.equal(r.status, 401, 'a token signed by an unpublished key must not pass');
    assert.equal(upstreamCalls.length, 0);
}

// ── 4. An expired token ─────────────────────────────────────────────────────
{
    const now = Math.floor(Date.now() / 1000);
    const token = await mintToken({ iat: now - 7200, exp: now - 60 });
    const r = await call(VALID_BODY, { token });
    assert.equal(r.status, 401);
    assert.equal(upstreamCalls.length, 0);
}

// ── 5. A token for another Firebase project ─────────────────────────────────
{
    const token = await mintToken({ aud: 'someone-elses-project' });
    const r = await call(VALID_BODY, { token });
    assert.equal(r.status, 401);
    assert.equal(upstreamCalls.length, 0);
}

// ── 6. Signed in, but not on the allowlist ──────────────────────────────────
// Sign-in is an open Google popup, so this is the check that actually stands
// between a stranger's account and the bill.
{
    const token = await mintToken({ sub: 'some-other-google-account' });
    const r = await call(VALID_BODY, { token });
    assert.equal(r.status, 403);
    assert.equal(r.json.error, 'ai_not_enabled_for_user');
    assert.equal(upstreamCalls.length, 0);
}

// ── 7. Allowlist unset: closed, not open ────────────────────────────────────
{
    const token = await mintToken();
    const r = await call(VALID_BODY, { token }, { ...ENV, AI_ALLOWED_UIDS: undefined });
    assert.equal(r.status, 403, 'an unset allowlist must fail closed');
    assert.equal(upstreamCalls.length, 0);
}

// ── 8. The happy path, and what actually goes upstream ──────────────────────
{
    const token = await mintToken();
    const r = await call({
        model: 'gpt-4o',                       // not ours — must be replaced
        max_tokens: 999999,                    // must be clamped
        system: 'system prompt',
        messages: [{ role: 'user', content: 'שאלה' }],
        tools: [{ name: 'exfiltrate' }],       // must be dropped, not proxied
        metadata: { user_id: 'spoofed' },
    }, { token });

    assert.equal(r.status, 200);
    assert.equal(r.json.text, 'תשובה מהמודל');
    assert.equal(upstreamCalls.length, 1);

    const sent = JSON.parse(upstreamCalls[0].init.body);
    assert.equal(sent.model, 'claude-sonnet-4-6', 'unknown models fall back to the default');
    assert.equal(sent.max_tokens, 4096, 'max_tokens is clamped');
    assert.equal(sent.tools, undefined, 'unforwarded fields are dropped');
    assert.equal(sent.metadata, undefined);
    assert.equal(upstreamCalls[0].init.headers['x-api-key'], ENV.ANTHROPIC_API_KEY);

    // The key must never come back out.
    assert.ok(!r.text.includes(ENV.ANTHROPIC_API_KEY));
}

// ── 9. Message shape is validated before anything is billed ─────────────────
{
    const token = await mintToken();
    for (const messages of [
        [],
        'not an array',
        [{ role: 'system', content: 'x' }],
        [{ role: 'user', content: { nested: 'object' } }],
        [null],
    ]) {
        const r = await call({ ...VALID_BODY, messages }, { token });
        assert.ok(r.status === 400, `expected 400 for ${JSON.stringify(messages)}, got ${r.status}`);
        assert.equal(upstreamCalls.length, 0);
    }
}

// ── 10. An upstream failure is reported without leaking its headers ─────────
{
    const token = await mintToken();
    upstreamReply = () => new Response(JSON.stringify({
        error: { type: 'authentication_error', message: 'invalid x-api-key' },
    }), { status: 401, headers: { 'request-id': 'req_abc123' } });

    const r = await call(VALID_BODY, { token });
    assert.equal(r.status, 502, 'an upstream 401 must not look like the user being signed out');
    assert.equal(r.json.upstreamStatus, 401);
    assert.ok(!r.text.includes('req_abc123'));

    upstreamReply = () => new Response(JSON.stringify({
        content: [{ type: 'text', text: 'תשובה מהמודל' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

// ── 11. Other origins cannot borrow the endpoint ────────────────────────────
{
    const token = await mintToken();
    const response = await worker.fetch(new Request(ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Origin': 'https://evil.example',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(VALID_BODY),
    }), ENV);
    assert.equal(response.status, 403);
}

// ── 12. The throttle stops a runaway loop ───────────────────────────────────
// Last, because it burns the hourly budget for the uid it uses.
{
    const uid = 'throttle-test-uid';
    const token = await mintToken({ sub: uid });
    const env = { ...ENV, AI_ALLOWED_UIDS: `${UID},${uid}` };
    let limited = 0;
    for (let i = 0; i < 45; i++) {
        const r = await call(VALID_BODY, { token }, env);
        if (r.status === 429) limited++;
    }
    assert.ok(limited >= 5, `expected the throttle to bite, got ${limited} rejections`);
}

console.log('✓ ai endpoint: 12 checks passed');
