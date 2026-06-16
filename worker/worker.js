/**
 * Cloudflare Worker - Yahoo Finance Proxy
 * פרוקסי פרטי לשליפת מחירים מ-Yahoo Finance ללא בעיות CORS
 *
 * Deploy: npx wrangler deploy
 * Free tier: 100,000 requests/day
 */

const ALLOWED_DOMAINS = [
  'query1.finance.yahoo.com',
  'query2.finance.yahoo.com',
  'finance.yahoo.com'
];

// Browser origins allowed to use this proxy (prevents quota abuse by other sites).
// Non-browser requests (no Origin header) are allowed — CORS doesn't apply to them.
function isAllowedOrigin(origin) {
  if (origin === 'https://dolevrokach08-a11y.github.io') return true;
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

// ── Max transaction ingestion API ──────────────────────────────────────────
// Routes under /api/transactions/* . D1 binding is `env.DB`.
//   POST /api/transactions/pending  ← scraper ingests (Bearer INGESTION_TOKEN)
//   GET  /api/transactions/pending  ← site fetches pending list (Origin-gated)
//   POST /api/transactions/approve  ← { id, final_category }
//   POST /api/transactions/reject   ← { id }
async function handleTransactionsApi(request, env, url, CORS) {
  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

  if (!env.DB) return json({ error: 'D1 not configured' }, 500);

  const path = url.pathname;
  const method = request.method;

  // ── Ingest from the scraper (server-to-server, Bearer auth) ──────────────
  if (path === '/api/transactions/pending' && method === 'POST') {
    const auth = request.headers.get('Authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!env.INGESTION_TOKEN || token !== env.INGESTION_TOKEN) {
      return json({ error: 'unauthorized' }, 401);
    }

    let body;
    try { body = await request.json(); } catch { return json({ error: 'invalid json' }, 400); }
    const txns = Array.isArray(body) ? body : body && body.transactions;
    if (!Array.isArray(txns)) return json({ error: 'expected { transactions: [...] }' }, 400);

    const now = new Date().toISOString();
    let inserted = 0, skipped = 0;
    for (const t of txns) {
      if (!t || !t.dedup_key) { skipped++; continue; }
      const res = await env.DB.prepare(
        `INSERT OR IGNORE INTO pending_transactions
           (id, source, card_account, max_identifier, dedup_key, transaction_date, processed_date,
            original_amount, original_currency, charged_amount, charged_currency,
            description, memo, max_category, suggested_category, confidence, raw_json, status, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?)`
      ).bind(
        crypto.randomUUID(), t.source || 'max-scraper', t.card_account || '', t.max_identifier ?? null,
        t.dedup_key, t.transaction_date, t.processed_date ?? null,
        t.original_amount, t.original_currency || 'ILS', t.charged_amount, t.charged_currency || 'ILS',
        t.description ?? null, t.memo ?? null, t.max_category ?? null, t.suggested_category ?? null,
        t.confidence ?? null, t.raw_json ?? null, now
      ).run();
      if (res.meta.changes > 0) inserted++; else skipped++; // skipped == already seen (dedup)
    }
    return json({ ok: true, received: txns.length, inserted, skipped });
  }

  // ── Site fetches the pending list (browser, Origin-gated) ────────────────
  if (path === '/api/transactions/pending' && method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT * FROM pending_transactions WHERE status = 'pending' ORDER BY transaction_date DESC`
    ).all();
    return json({ ok: true, count: results.length, transactions: results });
  }

  // ── Approve (optionally re-categorize) ───────────────────────────────────
  if (path === '/api/transactions/approve' && method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'invalid json' }, 400); }
    if (!body || !body.id) return json({ error: 'missing id' }, 400);
    const res = await env.DB.prepare(
      `UPDATE pending_transactions
          SET status = 'approved', approved_at = ?, final_category = ?
        WHERE id = ? AND status = 'pending'`
    ).bind(new Date().toISOString(), body.final_category ?? null, body.id).run();
    return json({ ok: res.meta.changes > 0, changed: res.meta.changes });
  }

  // ── Reject (duplicate / error) ───────────────────────────────────────────
  if (path === '/api/transactions/reject' && method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'invalid json' }, 400); }
    if (!body || !body.id) return json({ error: 'missing id' }, 400);
    const res = await env.DB.prepare(
      `UPDATE pending_transactions SET status = 'rejected' WHERE id = ? AND status = 'pending'`
    ).bind(body.id).run();
    return json({ ok: res.meta.changes > 0, changed: res.meta.changes });
  }

  return json({ error: 'not found' }, 404);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    if (origin && !isAllowedOrigin(origin)) {
      return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    const CORS_HEADERS = corsHeaders(origin);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const requestUrl = new URL(request.url);

    // ── Max transaction ingestion API (D1-backed) ───────────────────────────
    if (requestUrl.pathname.startsWith('/api/transactions/')) {
      return handleTransactionsApi(request, env, requestUrl, CORS_HEADERS);
    }

    // Everything below is the read-only Yahoo / CPI proxy — GET only.
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
    }

    // ── CPI route: proxy Israeli CBS (הלמ"ס) consumer price index ──────────
    if (requestUrl.pathname === '/cpi') {
      try {
        const cbsResp = await fetch(
          'https://api.cbs.gov.il/index/data/price?id=120010&format=json&lang=en',
          { headers: { 'User-Agent': 'FinanceTracker/1.0' }, cf: { cacheTtl: 3600, cacheEverything: true } }
        );
        const body = await cbsResp.arrayBuffer();
        return new Response(body, {
          status: cbsResp.status,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: 'CPI fetch failed', message: err.message }), {
          status: 502,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }
    }
    // ────────────────────────────────────────────────────────────────────────

    const targetUrl = requestUrl.searchParams.get('url');

    if (!targetUrl) {
      return new Response(JSON.stringify({ error: 'Missing ?url= parameter' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }

    // Validate domain - prevent open proxy abuse
    let parsedTarget;
    try {
      parsedTarget = new URL(decodeURIComponent(targetUrl));
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid URL' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }

    if (!ALLOWED_DOMAINS.includes(parsedTarget.hostname)) {
      return new Response(JSON.stringify({ error: 'Domain not allowed' }), {
        status: 403,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }

    try {
      const response = await fetch(decodeURIComponent(targetUrl), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        cf: {
          cacheTtl: 60,
          cacheEverything: true
        }
      });

      const body = await response.arrayBuffer();

      return new Response(body, {
        status: response.status,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': response.headers.get('Content-Type') || 'application/json',
          'X-Proxy': 'cf-worker'
        }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: 'Fetch failed', message: error.message }), {
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }
  }
};
