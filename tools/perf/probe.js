/**
 * Page-load performance probe (Phase 5, batch 0).
 *
 * Self-contained — no build, no deps. Paste the whole file into the page
 * (devtools console, or the Chrome MCP javascript_tool) and it resolves to a
 * single JSON row describing that load.
 *
 * Measure the DEPLOYED site, not vite: dev serves unminified and uncompressed,
 * so every byte number would be meaningless, and the SW scope differs.
 *
 * Protocol — identical every run or the numbers are noise:
 *   cold  = Application > Clear site data + unregister SW, then load
 *   warm  = second navigation with the SW already active (this is the
 *           owner's actual complaint: moving between pages)
 * Three runs per page/profile, record the median, log it to docs/perf-log.md
 * together with the commit SHA the numbers belong to.
 */
(async () => {
  const round = n => (n == null ? null : Math.round(n));

  // LCP/CLS observers must be installed before we read them. `buffered: true`
  // recovers entries emitted before this script ran, which is what makes the
  // probe usable as a paste-after-load snippet.
  let lcp = 0;
  let cls = 0;
  try {
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) lcp = Math.max(lcp, e.startTime);
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) if (!e.hadRecentInput) cls += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (_) { /* older browsers — timings below still work */ }

  // Let late work (charts, the 300ms unhide timers, background syncs) settle.
  if (document.readyState !== 'complete') {
    await new Promise(r => window.addEventListener('load', r, { once: true }));
  }
  await new Promise(r => setTimeout(r, 1500));

  const nav = performance.getEntriesByType('navigation')[0] || {};
  const paint = performance.getEntriesByType('paint');
  const fcp = (paint.find(p => p.name === 'first-contentful-paint') || {}).startTime;

  const res = performance.getEntriesByType('resource');
  const byOrigin = {};
  for (const r of res) {
    let origin;
    try { origin = new URL(r.name).origin; } catch (_) { origin = 'other'; }
    const o = byOrigin[origin] || (byOrigin[origin] = { n: 0, transfer: 0, decoded: 0 });
    o.n++;
    o.transfer += r.transferSize || 0;
    o.decoded += r.decodedBodySize || 0;
  }
  // transferSize === 0 with a non-zero body means it came from a cache
  // (SW or HTTP) rather than the network — the KPI for batch 2.
  const fromCache = res.filter(r => (r.transferSize || 0) === 0 && (r.decodedBodySize || 0) > 0).length;

  const self = location.origin;
  const thirdParty = Object.entries(byOrigin)
    .filter(([o]) => o !== self)
    .reduce((a, [, v]) => a + v.decoded, 0);

  return {
    page: location.pathname.split('/').pop() || 'index.html',
    sw: navigator.serviceWorker && navigator.serviceWorker.controller ? 'sw' : 'no-sw',

    ttfb: round(nav.responseStart - nav.startTime),
    fcp: round(fcp),
    lcp: round(lcp),
    cls: cls ? Number(cls.toFixed(3)) : 0,
    domInteractive: round(nav.domInteractive),
    dcl: round(nav.domContentLoadedEventEnd),
    load: round(nav.loadEventEnd),

    docTransfer: round(nav.transferSize),
    docDecoded: round(nav.decodedBodySize),

    requests: res.length,
    fromCache,
    transferTotal: round(res.reduce((a, r) => a + (r.transferSize || 0), 0)),
    decodedTotal: round(res.reduce((a, r) => a + (r.decodedBodySize || 0), 0)),
    thirdPartyDecoded: round(thirdParty),

    // The direct KPI for batch 1 — every one of these delays first paint.
    blockingScripts: document.querySelectorAll('script[src]:not([defer]):not([async])').length,

    byOrigin: Object.fromEntries(
      Object.entries(byOrigin)
        .sort((a, b) => b[1].decoded - a[1].decoded)
        .map(([o, v]) => [o, { n: v.n, transfer: round(v.transfer), decoded: round(v.decoded) }])
    ),
    top: res
      .slice()
      .sort((a, b) => (b.decodedBodySize || 0) - (a.decodedBodySize || 0))
      .slice(0, 10)
      .map(r => ({ url: r.name.replace(/^https?:\/\//, '').slice(0, 90), decoded: round(r.decodedBodySize) }))
  };
})();
