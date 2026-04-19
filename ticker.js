/* =========================================================================
   Live Ticker Bar — fetches Yahoo Finance data via Cloudflare Worker
   Usage:
     <div class="ticker-bar" id="liveTicker"></div>
     <script src="ticker.js"></script>
     <script>initTicker({ includeHoldings: true });</script>
   ========================================================================= */
(function (window) {
    'use strict';

    const WORKER_URL = 'https://finance-proxy.dolevrokach08.workers.dev/?url=';
    const CACHE_KEY = 'tickerCache_v1';
    const CACHE_TTL = 2 * 60 * 1000; // 2 minutes
    const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

    // Default market + FX symbols (always shown)
    const DEFAULT_SYMBOLS = [
        { symbol: '^TA35.TA', display: 'TA-35' },
        { symbol: '^TA125.TA', display: 'TA-125' },
        { symbol: 'USDILS=X', display: 'USD/ILS' },
        { symbol: 'EURILS=X', display: 'EUR/ILS' },
        { symbol: '^GSPC', display: 'S&P 500' },
        { symbol: '^IXIC', display: 'NASDAQ' },
        { symbol: 'BTC-USD', display: 'BTC' },
        { symbol: 'GC=F', display: 'GOLD' },
        { symbol: 'CL=F', display: 'OIL' }
    ];

    // ================= MARKET STATUS =================
    function getMarketStatus() {
        const now = new Date();
        // TASE: Sun-Thu, 09:30-17:35 Israel time
        const ilHour = parseInt(now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hour12: false }));
        const ilMin = parseInt(now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem', minute: '2-digit' }));
        const ilDay = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' })).getDay(); // 0=Sun
        const taseMinutes = ilHour * 60 + ilMin;
        const taseOpen = ilDay >= 0 && ilDay <= 4 && taseMinutes >= 9 * 60 + 30 && taseMinutes < 17 * 60 + 35;

        // NYSE: Mon-Fri, 09:30-16:00 New York time
        const nyHour = parseInt(now.toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false }));
        const nyMin = parseInt(now.toLocaleString('en-US', { timeZone: 'America/New_York', minute: '2-digit' }));
        const nyDay = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' })).getDay();
        const nyseMinutes = nyHour * 60 + nyMin;
        const nyseOpen = nyDay >= 1 && nyDay <= 5 && nyseMinutes >= 9 * 60 + 30 && nyseMinutes < 16 * 60;

        if (taseOpen && nyseOpen) return { open: true, label: 'MARKETS OPEN' };
        if (taseOpen) return { open: true, label: 'TASE OPEN' };
        if (nyseOpen) return { open: true, label: 'NYSE OPEN' };
        return { open: false, label: 'MARKETS CLOSED' };
    }

    // ================= PRICE FETCHING =================
    async function fetchYahooPrice(symbol) {
        try {
            const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
            const url = WORKER_URL + encodeURIComponent(yahooUrl);
            const response = await fetch(url);
            if (!response.ok) return null;
            const data = await response.json();
            const result = data?.chart?.result?.[0];
            if (!result) return null;
            const meta = result.meta || {};
            const price = meta.regularMarketPrice;
            const prevClose = meta.chartPreviousClose || meta.previousClose;
            if (!price) return null;
            const change = prevClose ? ((price - prevClose) / prevClose) * 100 : 0;
            return { price, change, currency: meta.currency || 'USD' };
        } catch (e) {
            console.warn('ticker fetch failed:', symbol, e);
            return null;
        }
    }

    // ================= CACHE =================
    function loadCache() {
        try {
            const raw = localStorage.getItem(CACHE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || !parsed.timestamp) return null;
            return parsed;
        } catch (e) { return null; }
    }

    function saveCache(data) {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data }));
        } catch (e) {}
    }

    // ================= HOLDINGS FROM LOCALSTORAGE =================
    function getUserHoldings(max) {
        try {
            const raw = localStorage.getItem('portfolio');
            if (!raw) return [];
            const p = JSON.parse(raw);
            const holdings = Array.isArray(p.holdings) ? p.holdings : [];
            return holdings
                .filter(h => h.symbol && (h.shares || 0) > 0)
                .map(h => ({
                    symbol: (h.altTicker || h.symbol).trim(),
                    display: h.symbol,
                    value: (h.shares || 0) * (h.currentPrice || 0)
                }))
                .sort((a, b) => b.value - a.value)
                .slice(0, max || 5);
        } catch (e) { return []; }
    }

    // ================= RENDER =================
    function formatPrice(price, symbol) {
        if (price == null) return '--';
        if (symbol && symbol.includes('=X')) return price.toFixed(3); // FX
        if (price >= 1000) return price.toLocaleString('en-US', { maximumFractionDigits: price >= 10000 ? 0 : 2 });
        if (price >= 10) return price.toFixed(2);
        return price.toFixed(4);
    }

    function renderTickerItem(item) {
        if (!item || item.price == null) return '';
        const change = item.change || 0;
        const dir = change > 0.005 ? 'up' : change < -0.005 ? 'down' : 'flat';
        const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '■';
        const sign = change > 0 ? '+' : '';
        const staleClass = item.stale ? ' stale' : '';
        return `<span class="ticker-item${staleClass}">
            <span class="symbol">${item.display}</span>
            <span class="price">${formatPrice(item.price, item.symbol)}</span>
            <span class="change ${dir}"><span class="arrow">${arrow}</span> ${sign}${change.toFixed(2)}%</span>
        </span>`;
    }

    function renderTicker(container, items) {
        if (!container) return;
        const valid = items.filter(i => i && i.price != null);
        if (valid.length === 0) {
            container.innerHTML = '';
            return;
        }
        const html = valid.map(renderTickerItem).join('');
        // Duplicate content for seamless loop
        container.innerHTML = html + html;
    }

    function updateMarketStatus(statusEl) {
        if (!statusEl) return;
        const status = getMarketStatus();
        statusEl.className = 'market-status' + (status.open ? '' : ' closed');
        statusEl.innerHTML = `<span class="dot${status.open ? ' pulse' : ''}"></span><span class="label-text">${status.label}</span>`;
    }

    // ================= MAIN INIT =================
    async function initTicker(options) {
        options = options || {};
        const includeHoldings = options.includeHoldings !== false;
        const maxHoldings = options.maxHoldings || 5;
        const barId = options.barId || 'liveTicker';
        const bar = document.getElementById(barId);
        if (!bar) return;

        // Scaffold DOM
        bar.innerHTML = `
            <div class="market-status"><span class="dot pulse"></span><span class="label-text">MARKETS</span></div>
            <div class="ticker-viewport"><div class="ticker-scroll" id="${barId}-scroll"></div></div>
        `;
        const statusEl = bar.querySelector('.market-status');
        const scrollEl = bar.querySelector('.ticker-scroll');

        updateMarketStatus(statusEl);
        setInterval(() => updateMarketStatus(statusEl), 60 * 1000);

        async function refresh() {
            const cached = loadCache();
            const now = Date.now();
            let items = [];

            // Build symbol list
            const holdings = includeHoldings ? getUserHoldings(maxHoldings) : [];
            const symbolsToFetch = [...holdings, ...DEFAULT_SYMBOLS];

            // If cache fresh, use it directly
            if (cached && (now - cached.timestamp) < CACHE_TTL && cached.data && cached.data.length > 0) {
                items = cached.data.map(d => ({ ...d, stale: false }));
                renderTicker(scrollEl, items);
                return;
            }

            // Render cached (stale) immediately while we fetch
            if (cached && cached.data && cached.data.length > 0) {
                renderTicker(scrollEl, cached.data.map(d => ({ ...d, stale: true })));
            }

            // Fetch all in parallel (Promise.allSettled to tolerate failures)
            const results = await Promise.allSettled(
                symbolsToFetch.map(async s => {
                    const data = await fetchYahooPrice(s.symbol);
                    if (!data) return null;
                    return { symbol: s.symbol, display: s.display, price: data.price, change: data.change };
                })
            );
            items = results
                .filter(r => r.status === 'fulfilled' && r.value)
                .map(r => r.value);

            if (items.length > 0) {
                saveCache(items);
                renderTicker(scrollEl, items);
            } else if (cached && cached.data) {
                // All failed — keep showing stale cache
                renderTicker(scrollEl, cached.data.map(d => ({ ...d, stale: true })));
            }
        }

        refresh();
        setInterval(refresh, REFRESH_INTERVAL);
    }

    window.initTicker = initTicker;
})(window);
