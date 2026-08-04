/**
 * On-demand script loading.
 *
 * Several third-party libraries were blocking every page load while serving one
 * hidden file input or one chart tab: SheetJS (~900KB) on portfolio and finance,
 * d3 + d3-sankey for a single flow diagram, pdf.js and tesseract for the payslip
 * scanner. This loads each one the first time it is actually needed.
 *
 * Deliberately a CLASSIC script, not a module: finance.html calls it from plain
 * inline scripts, and mortgage/tax don't load shared/data.js at all. Modules can
 * read window.FTLoad fine, so nothing is lost.
 *
 * V is the single place every third-party URL lives — the vendor-update workflow
 * rewrites this object rather than hunting through five HTML files.
 */
(function (w) {
  'use strict';

  // Self-hosted under vendor/, with the version in each filename — that is what
  // lets the service worker treat them as cache-first with no revalidation: a
  // different version is a different URL, so a cache hit can never be stale.
  // Keeps every library on one origin instead of five, which matters most behind
  // a TLS-intercepting filter where each extra host is another handshake.
  // vendor/manifest.json drives the weekly update workflow that bumps these.
  //
  // tesseract.js deliberately stays on the CDN: its entry point is a thin loader
  // that fetches a ~4MB wasm core and a ~10MB+ Hebrew language model at runtime.
  // Self-hosting means committing ~15MB of binaries and hand-maintaining
  // workerPath/corePath/langPath — and since batch 3 it costs nothing on load.
  var V = {
    xlsx:      'vendor/xlsx-0.18.5.full.min.js',
    chart3:    'vendor/chart.js-3.9.1.min.js',
    chart4:    'vendor/chart.js-4.5.1.min.js',
    d3:        'vendor/d3-7.9.0.min.js',
    d3sankey:  'vendor/d3-sankey-0.12.3.min.js',
    pdfjs:     'vendor/pdfjs-3.11.174/pdf.min.js',
    pdfWorker: 'vendor/pdfjs-3.11.174/pdf.worker.min.js',
    lucide:    'vendor/lucide-1.17.0.min.js',
    tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js'
  };

  var cache = Object.create(null);

  function loadScriptOnce(url) {
    if (cache[url]) return cache[url];
    cache[url] = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = url;
      // Dynamically inserted scripts default to async=true. Chained loads
      // (d3-sankey needs the d3 global) would race without this.
      s.async = false;
      s.onload = function () { resolve(url); };
      s.onerror = function () {
        // Drop the rejected promise so a later retry can actually retry.
        delete cache[url];
        reject(new Error('Failed to load ' + url));
      };
      document.head.appendChild(s);
    });
    return cache[url];
  }

  function chain(urls) {
    return urls.reduce(function (p, u) {
      return p.then(function () { return loadScriptOnce(u); });
    }, Promise.resolve());
  }

  w.FTLoad = {
    urls: V,
    script: loadScriptOnce,
    xlsx:      function () { return loadScriptOnce(V.xlsx); },
    chart3:    function () { return loadScriptOnce(V.chart3); },
    chart4:    function () { return loadScriptOnce(V.chart4); },
    d3sankey:  function () { return chain([V.d3, V.d3sankey]); },
    tesseract: function () { return loadScriptOnce(V.tesseract); },
    lucide:    function () { return loadScriptOnce(V.lucide); },
    pdfjs:     function () {
      return loadScriptOnce(V.pdfjs).then(function () {
        if (w.pdfjsLib) w.pdfjsLib.GlobalWorkerOptions.workerSrc = V.pdfWorker;
      });
    }
  };
})(window);
