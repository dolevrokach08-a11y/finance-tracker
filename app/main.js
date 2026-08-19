import { createStore } from './core/store.js';
import { HtmlModuleRouter } from './core/router.js';
import { createFirebaseSession } from './core/firebase-session.js';

const routes = {
    home: {
        id: 'home',
        title: 'התמונה הפיננסית שלך',
        subtitle: 'הנתונים החשובים מחוברים לתמונה אחת',
        fragment: './app/modules/home/home.html',
        load: () => import('./modules/home/home.js'),
        icon: 'layout-dashboard',
        keywords: 'ראשי תמונה כוללת סיכום הון',
    },
    portfolio: {
        id: 'portfolio',
        title: 'תיק ההשקעות',
        subtitle: 'תשואה, הקצאה וניהול סיכון',
        legacyUrl: 'portfolio.html',
        icon: 'line-chart',
        keywords: 'תיק השקעות מניות אגח תשואה',
    },
    finance: {
        id: 'finance',
        title: 'תזרים ומעקב כספי',
        subtitle: 'הכנסות, הוצאות, תקציב ויעדים',
        legacyUrl: 'finance.html',
        icon: 'wallet-cards',
        keywords: 'כסף תזרים הוצאות הכנסות תקציב',
    },
    mortgage: {
        id: 'mortgage',
        title: 'תכנון משכנתא',
        subtitle: 'תמהילים, תרחישים ומבחני לחץ',
        legacyUrl: 'mortgage.html',
        icon: 'landmark',
        keywords: 'משכנתא דיור הלוואה תרחיש ריבית',
    },
    tax: {
        id: 'tax',
        title: 'אופטימיזציית מס',
        subtitle: 'זכויות, נקודות זיכוי וחיסכון פוטנציאלי',
        legacyUrl: 'tax-optimizer.html',
        icon: 'calculator',
        keywords: 'מס זכויות נקודות זיכוי תלוש',
    },
};

const store = createStore({
    session: { status: 'connecting', user: null, isDemo: false },
    data: { finance: null, portfolio: null, mortgage: null, cachedTwr: null },
    cloud: { status: 'idle', updatedAt: null },
});

const outlet = document.getElementById('app-outlet');
const router = new HtmlModuleRouter({
    outlet,
    routes,
    context: { store },
    onRouteChange(route) {
        document.body.dataset.route = route.id;
        document.getElementById('routeTitle').textContent = route.title;
        document.getElementById('routeSubtitle').textContent = route.subtitle;
        document.querySelectorAll('[data-route]').forEach(link => {
            const active = link.dataset.route === route.id;
            link.classList.toggle('is-active', active);
            if (active) link.setAttribute('aria-current', 'page');
            else link.removeAttribute('aria-current');
        });
    },
});

router.start();

let sessionApi = null;
createFirebaseSession(store)
    .then(api => { sessionApi = api; })
    .catch(error => {
        console.error('[app] session initialization failed', error);
        store.setState({
            session: { status: 'error', user: null, isDemo: false },
            cloud: { status: 'offline', updatedAt: null },
        }, 'session:error');
    });

function updateSessionChrome(state) {
    const { session, cloud } = state;
    const name = session.user?.displayName || session.user?.email || (session.status === 'error' ? 'שגיאת חיבור' : 'מתחבר…');
    const avatar = document.getElementById('sessionAvatar');
    document.getElementById('sessionName').textContent = name;
    avatar.textContent = name.trim().charAt(0) || 'F';
    if (session.user?.photoURL) {
        avatar.style.backgroundImage = `url("${String(session.user.photoURL).replace(/"/g, '%22')}")`;
        avatar.textContent = '';
    } else {
        avatar.style.backgroundImage = '';
    }

    const labels = {
        syncing: 'מסנכרן נתונים',
        ready: 'מעודכן מהענן',
        offline: 'עובד מהמטמון המקומי',
        demo: 'מצב הדגמה',
        idle: 'מכין נתונים',
    };
    document.getElementById('sessionStatus').textContent = labels[cloud.status] || 'מערכת פעילה';
}

store.subscribe(updateSessionChrome, { immediate: true });

function updateClock() {
    const now = new Date();
    document.getElementById('clockTime').textContent = now.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false });
    document.getElementById('clockDate').textContent = now.toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'short' });
}
updateClock();
setInterval(updateClock, 30_000);

const sessionMenu = document.getElementById('sessionMenu');
document.getElementById('sessionMenuButton').addEventListener('click', event => {
    event.stopPropagation();
    sessionMenu.hidden = !sessionMenu.hidden;
});
document.addEventListener('click', event => {
    if (!event.target.closest('.rail-session')) sessionMenu.hidden = true;
});
document.getElementById('logoutButton').addEventListener('click', () => sessionApi?.logout());
function toggleAppTheme() {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    if (isLight) document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', 'light');
    localStorage.setItem('theme', isLight ? 'dark' : 'light');
    sessionMenu.hidden = true;
}

document.getElementById('themeToggle').addEventListener('click', toggleAppTheme);
document.getElementById('themeQuickToggle').addEventListener('click', toggleAppTheme);

const commandBackdrop = document.getElementById('commandBackdrop');
const commandInput = document.getElementById('commandInput');
const commandResults = document.getElementById('commandResults');
let commandSelection = 0;

// Palette entries are either a route (navigate) or an action (run). Actions
// live here rather than in `routes` so the rail keeps showing only real
// destinations.
const commandActions = [
    {
        id: 'assistant',
        title: 'עוזר AI',
        subtitle: 'שאל שאלה על התיק ועל התזרים',
        keywords: 'ai עוזר בינה שאלה ניתוח',
        icon: 'sparkles',
        run: () => toggleAssistant(),
    },
];

function commandItems(query = '') {
    const normalized = query.trim().toLowerCase();
    return [...Object.values(routes), ...commandActions]
        .filter(item => !normalized || `${item.title} ${item.subtitle} ${item.keywords}`.toLowerCase().includes(normalized));
}

function renderCommands() {
    const items = commandItems(commandInput.value);
    commandSelection = Math.max(0, Math.min(commandSelection, items.length - 1));
    commandResults.innerHTML = items.length ? items.map((route, index) => `
        <button class="command-result ${index === commandSelection ? 'is-selected' : ''}" type="button" data-command-route="${route.id}">
            <span class="command-result-icon"><i data-lucide="${route.icon}"></i></span>
            <span class="command-result-copy"><strong>${route.title}</strong><small>${route.subtitle}</small></span>
            <small>0${index + 1}</small>
        </button>`).join('') : '<div class="command-empty">לא נמצאה פעולה מתאימה</div>';
    window.lucide?.createIcons?.();
}

function openCommand() {
    commandBackdrop.hidden = false;
    commandInput.value = '';
    commandSelection = 0;
    renderCommands();
    requestAnimationFrame(() => commandInput.focus());
}

function closeCommand() {
    commandBackdrop.hidden = true;
}

function activateCommand(item) {
    if (!item) return;
    closeCommand();
    if (typeof item.run === 'function') item.run();
    else router.navigate(item.id);
}

function runSelectedCommand() {
    activateCommand(commandItems(commandInput.value)[commandSelection]);
}

document.getElementById('openCommand').addEventListener('click', openCommand);
document.getElementById('topbarCommand').addEventListener('click', openCommand);
commandBackdrop.addEventListener('click', event => { if (event.target === commandBackdrop) closeCommand(); });
commandInput.addEventListener('input', () => { commandSelection = 0; renderCommands(); });
commandResults.addEventListener('click', event => {
    const button = event.target.closest('[data-command-route]');
    if (!button) return;
    activateCommand(commandItems(commandInput.value).find(item => item.id === button.dataset.commandRoute));
});
document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        commandBackdrop.hidden ? openCommand() : closeCommand();
        return;
    }
    if (commandBackdrop.hidden) return;
    if (event.key === 'Escape') closeCommand();
    if (event.key === 'ArrowDown') { event.preventDefault(); commandSelection += 1; renderCommands(); }
    if (event.key === 'ArrowUp') { event.preventDefault(); commandSelection -= 1; renderCommands(); }
    if (event.key === 'Enter') { event.preventDefault(); runSelectedCommand(); }
});

// The legacy pages each hand the assistant their own page globals. Here the
// shell already owns the read model, so point it at the store instead — the
// assistant then sees exactly what the visible route sees.
let assistant = null;
function ensureAssistant() {
    if (assistant) return assistant;
    if (typeof window.FinancialAIAssistant !== 'function') return null;
    assistant = new window.FinancialAIAssistant({
        getFinanceData: () => store.getState().data?.finance || {},
        getPortfolioData: () => store.getState().data?.portfolio || {},
    });
    return assistant;
}

function toggleAssistant() {
    ensureAssistant()?.toggle();
}

// Same shortcut the portfolio page uses, so the habit carries across the app.
document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        toggleAssistant();
    }
});

window.addEventListener('load', () => {
    window.lucide?.createIcons?.();
    ensureAssistant();
});

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    const isLocalDev = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    if (isLocalDev) {
        navigator.serviceWorker.getRegistrations().then(registrations =>
            Promise.all(registrations.map(registration => registration.unregister()))
        );
    } else {
        // updateViaCache:'none' matches the other pages — without it the browser
        // may serve sw.js itself from HTTP cache and pin the app to old code.
        navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
            .catch(error => console.warn('Service worker registration failed', error));
    }
}
