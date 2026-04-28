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

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
    }

    const requestUrl = new URL(request.url);

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
