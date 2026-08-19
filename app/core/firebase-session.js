import {
    isDemoMode,
    exitDemoMode,
    ensureDemoStorageSandbox,
    getDemoUser,
    generateDemoFinanceData,
    generateDemoPortfolioData,
    generateDemoMortgageData,
} from '../../demo-data.js';
import { SyncBus } from '../../shared/sync-bus.js';

const DATASETS = [
    { id: 'portfolio', collection: 'portfolio', localKey: 'portfolio', metaKey: 'portfolio_sync_meta' },
    { id: 'finance', collection: 'finance', localKey: 'financeTrackerData', metaKey: 'financeTrackerData_meta' },
    { id: 'mortgage', collection: 'mortgage', localKey: 'mortgageData', metaKey: 'mortgage_sync_meta' },
];

function readJSON(key, fallback = null) {
    try {
        const raw = localStorage.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
    } catch {
        return fallback;
    }
}

function readLocalData(demo = false) {
    if (demo) {
        // Read the seeded sandbox first. The generators randomise several amounts
        // on every call, so generating here made this screen disagree with the
        // legacy pages, which read what seedDemoStorage() wrote once.
        return {
            finance: readJSON('financeTrackerData', null) || generateDemoFinanceData(),
            portfolio: readJSON('portfolio', null) || generateDemoPortfolioData(),
            mortgage: readJSON('mortgageState', null) || generateDemoMortgageData(),
            cachedTwr: null,
            // The demo sandbox is isolated localStorage, so a summary written
            // there by finance.html describes the demo data — same contract as
            // the real path, and it keeps the two demo screens agreeing.
            cachedFinance: readJSON('finance_cachedSummary', null),
        };
    }
    const finance = readJSON('financeTrackerData', demo ? generateDemoFinanceData() : null);
    const portfolio = readJSON('portfolio', demo ? generateDemoPortfolioData() : null);
    const mortgage = readJSON('mortgageData', readJSON('mortgage', null));
    const cachedTwr = readJSON('portfolio_cachedTWR', null);
    const cachedFinance = readJSON('finance_cachedSummary', null);
    return { finance, portfolio, mortgage, cachedTwr, cachedFinance };
}

function withTimeout(promise, ms = 15000) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Firestore timeout')), ms)),
    ]);
}

function canReplaceLocal(dataset, cloud) {
    const meta = readJSON(dataset.metaKey, null);
    if (meta?.hasUnsyncedChanges) return false;
    const cloudModified = cloud?.lastModified || null;
    if (cloudModified && meta?.localLastModified && cloudModified <= meta.localLastModified) return false;
    if (!cloudModified && localStorage.getItem(dataset.localKey) === JSON.stringify(cloud)) return false;
    return true;
}

export async function createFirebaseSession(store) {
    let firebase = null;
    let currentUser = null;
    let unsubscribeSync = null;
    const demo = isDemoMode();
    if (demo) ensureDemoStorageSandbox();

    store.setState({
        session: { status: 'connecting', user: null, isDemo: demo },
        // Never expose the plain cache before Firebase confirms which user owns
        // it. login.html normally performs the swap first, but deep links must
        // remain safe too.
        data: demo ? readLocalData(true) : { finance: null, portfolio: null, mortgage: null, cachedTwr: null },
        cloud: { status: demo ? 'demo' : 'idle', updatedAt: null },
    }, 'session:bootstrap');

    async function refreshFromCloud() {
        if (demo || !firebase || !currentUser) return;
        store.setState({ cloud: { status: 'syncing', updatedAt: store.getState().cloud?.updatedAt || null } }, 'cloud:syncing');

        let changed = false;
        let successfulReads = 0;
        await Promise.all(DATASETS.map(async dataset => {
            try {
                const reference = firebase.doc(firebase.db, 'users', currentUser.uid, dataset.collection, 'data');
                const snapshot = await withTimeout(firebase.getDoc(reference));
                successfulReads += 1;
                if (!snapshot.exists()) return;
                const cloud = snapshot.data();
                if (!canReplaceLocal(dataset, cloud)) return;
                localStorage.setItem(dataset.localKey, JSON.stringify(cloud));
                if (cloud.lastModified) {
                    localStorage.setItem(dataset.metaKey, JSON.stringify({
                        localLastModified: cloud.lastModified,
                        cloudLastModified: cloud.lastModified,
                        hasUnsyncedChanges: false,
                    }));
                }
                changed = true;
            } catch (error) {
                console.warn(`[session] ${dataset.id} refresh failed`, error);
            }
        }));

        const updatedAt = successfulReads ? Date.now() : store.getState().cloud?.updatedAt || null;
        store.setState({
            ...(changed ? { data: readLocalData(false) } : {}),
            cloud: { status: successfulReads ? 'ready' : 'offline', updatedAt },
        }, changed ? 'cloud:refreshed' : 'cloud:settled');
    }

    async function logout() {
        if (demo) {
            exitDemoMode();
            window.location.replace('login.html');
            return;
        }
        if (window.UserStorage) window.UserStorage.clearOnLogout();
        if (firebase?.auth) await firebase.signOut(firebase.auth);
        window.location.replace('login.html');
    }

    if (demo) {
        currentUser = getDemoUser();
        store.setState({
            session: { status: 'ready', user: currentUser, isDemo: true },
            cloud: { status: 'demo', updatedAt: Date.now() },
        }, 'session:demo-ready');
    } else {
        firebase = await import('../../firebase-config.js');
        currentUser = await new Promise(resolve => {
            let stop = () => {};
            stop = firebase.onAuthStateChanged(firebase.auth, user => {
                stop();
                resolve(user || null);
            });
        });

        if (!currentUser) {
            window.location.replace('login.html');
            return { logout, refresh: refreshFromCloud, destroy() {} };
        }

        if (window.UserStorage) window.UserStorage.syncToUser(currentUser.uid);
        store.setState({
            session: { status: 'ready', user: currentUser, isDemo: false },
            data: readLocalData(false),
            cloud: { status: navigator.onLine ? 'syncing' : 'offline', updatedAt: null },
        }, 'session:ready');
        refreshFromCloud();
    }

    unsubscribeSync = SyncBus.subscribe(() => {
        store.setState({ data: readLocalData(demo) }, 'data:external-change');
        if (!demo) refreshFromCloud();
    });

    return {
        logout,
        refresh: refreshFromCloud,
        destroy() { unsubscribeSync?.(); },
    };
}
