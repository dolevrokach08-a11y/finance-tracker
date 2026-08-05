function normalizeRoute(value) {
    return String(value || '')
        .replace(/^#\/?/, '')
        .replace(/^\//, '')
        .split(/[?#]/)[0] || 'home';
}

export class HtmlModuleRouter {
    constructor({ outlet, routes, context, onRouteChange }) {
        this.outlet = outlet;
        this.routes = routes;
        this.context = context;
        this.onRouteChange = onRouteChange;
        this.currentRoute = null;
        this.cleanup = null;
        this.renderToken = 0;
        this.handleDocumentClick = this.handleDocumentClick.bind(this);
        this.handlePopState = this.handlePopState.bind(this);
    }

    start() {
        document.addEventListener('click', this.handleDocumentClick);
        window.addEventListener('popstate', this.handlePopState);
        const route = normalizeRoute(location.hash);
        this.navigate(this.routes[route] ? route : 'home', { replace: true });
    }

    destroy() {
        document.removeEventListener('click', this.handleDocumentClick);
        window.removeEventListener('popstate', this.handlePopState);
        if (typeof this.cleanup === 'function') this.cleanup();
    }

    handleDocumentClick(event) {
        const link = event.target.closest('a[data-route]');
        if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const route = normalizeRoute(link.dataset.route);
        if (!this.routes[route]) return;
        event.preventDefault();
        this.navigate(route);
    }

    handlePopState() {
        const route = normalizeRoute(location.hash);
        if (this.routes[route]?.legacyUrl) return;
        this.navigate(this.routes[route] ? route : 'home', { fromHistory: true });
    }

    async navigate(routeName, options = {}) {
        const route = this.routes[normalizeRoute(routeName)] || this.routes.home;
        const name = route.id;

        if (route.legacyUrl) {
            document.body.classList.add('is-leaving');
            document.querySelectorAll(`[data-route="${name}"]`).forEach(node => node.classList.add('is-leaving'));
            this.onRouteChange?.(route, { leaving: true });
            window.setTimeout(() => window.location.assign(route.legacyUrl), 140);
            return;
        }

        if (!options.fromHistory) {
            const nextUrl = `${location.pathname}#/${name}`;
            if (options.replace) history.replaceState({ route: name }, '', nextUrl);
            else if (this.currentRoute !== name) history.pushState({ route: name }, '', nextUrl);
        }

        if (this.currentRoute === name && !options.force) return;
        this.currentRoute = name;
        this.onRouteChange?.(route, { leaving: false });

        const token = ++this.renderToken;
        this.outlet.setAttribute('aria-busy', 'true');

        try {
            const [fragmentResponse, module] = await Promise.all([
                fetch(route.fragment, { cache: 'no-cache' }),
                route.load(),
                this.ensureStylesheet(route.stylesheet),
            ]);
            if (!fragmentResponse.ok) throw new Error(`Failed to load ${route.fragment}: ${fragmentResponse.status}`);
            const html = await fragmentResponse.text();
            if (token !== this.renderToken) return;

            if (typeof this.cleanup === 'function') {
                try { this.cleanup(); } catch (error) { console.warn('[router] cleanup failed', error); }
            }

            this.outlet.innerHTML = html;
            this.outlet.scrollTop = 0;
            this.cleanup = await module.mount({
                root: this.outlet,
                route,
                router: this,
                ...this.context,
            });
            window.lucide?.createIcons?.();
            this.outlet.setAttribute('aria-busy', 'false');
            this.outlet.focus({ preventScroll: true });
        } catch (error) {
            console.error('[router] route failed', error);
            this.outlet.innerHTML = `
                <div class="route-error" role="alert">
                    <span>לא הצלחנו לפתוח את המסך</span>
                    <strong>המידע שלך לא נפגע.</strong>
                    <button type="button" data-retry-route="${name}">נסה שוב</button>
                </div>`;
            this.outlet.querySelector('[data-retry-route]')?.addEventListener('click', () => this.navigate(name, { force: true }));
            this.outlet.setAttribute('aria-busy', 'false');
        }
    }

    ensureStylesheet(href) {
        if (!href) return Promise.resolve();
        const absolute = new URL(href, document.baseURI).href;
        const existing = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).find(link => link.href === absolute);
        if (existing) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = href;
            link.onload = resolve;
            link.onerror = reject;
            document.head.appendChild(link);
        });
    }
}
