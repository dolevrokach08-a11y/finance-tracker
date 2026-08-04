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

  var V = {
    xlsx:      'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
    chart3:    'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/3.9.1/chart.min.js',
    chart4:    'https://cdn.jsdelivr.net/npm/chart.js@4.5.1',
    d3:        'https://d3js.org/d3.v7.min.js',
    d3sankey:  'https://unpkg.com/d3-sankey@0.12.3/dist/d3-sankey.min.js',
    pdfjs:     'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
    tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
    lucide:    'https://unpkg.com/lucide@1.17.0'
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
