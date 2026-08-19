/**
 * Shared navigation bar component — the unified cross-page strip
 * (Phase 4b, per the Claude Design mockups: brand + text links + active pill).
 * Usage: import { injectNav, setNavUser } from './shared/nav.js';
 *        injectNav('finance');   // pass current page key
 *        setNavUser(user);       // call after auth resolves
 * Pages that host their own #syncWidgetSlot must pass an unused slot id:
 *        injectNav('portfolio', 'sharedNavSyncSlot');
 */

const NAV_PAGES = [
  { href: 'app.html#/home',     label: 'בית',      title: 'התמונה הפיננסית הכוללת', key: 'index',     icon: 'home' },
  { href: 'portfolio.html',     label: 'השקעות',   title: 'תיק השקעות, תשואה וסיכון', key: 'portfolio', icon: 'portfolio' },
  { href: 'finance.html',       label: 'תזרים',    title: 'הכנסות, הוצאות ויעדים',    key: 'finance',   icon: 'finance' },
  { href: 'mortgage.html',      label: 'משכנתא',   title: 'תרחישים ותכנון משכנתא',    key: 'mortgage',  icon: 'mortgage' },
  { href: 'tax-optimizer.html', label: 'מס',       title: 'זכויות ואופטימיזציית מס', key: 'tax',       icon: 'tax' },
];

const NAV_ICONS = {
  home: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg>',
  portfolio: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V9m6 10V5m6 14v-7m4 7H2"/><path d="m4 8 6-4 6 7 4-3"/></svg>',
  finance: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5h14a2 2 0 0 1 2 2v9H4a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2h12"/><path d="M15 12h5m-2.5-1.5v3"/></svg>',
  mortgage: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5M9 21v-7h6v7"/></svg>',
  tax: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="2.5" width="16" height="19" rx="2"/><path d="M8 7h8M8 12h2m4 0h2M8 16.5h2m4 0h2"/></svg>',
  theme: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/><circle cx="12" cy="12" r="4"/></svg>',
};

const NAV_CSS = `
.shared-nav {
  --shared-nav-accent: #c9ff47;
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 92px;
  box-sizing: border-box;
  padding: 18px 10px 14px;
  background: linear-gradient(180deg, rgba(255,255,255,.025), transparent 45%), rgba(8, 9, 12, .86);
  border-left: 1px solid rgba(255, 255, 255, 0.09);
  backdrop-filter: blur(24px);
  box-shadow: -14px 0 45px rgba(0, 0, 0, 0.13);
  direction: rtl;
  view-transition-name: app-nav;
}
.has-shared-nav-rail { padding-right: 92px !important; box-sizing: border-box !important; --app-bottom-dock: 0px; }
.has-shared-nav-rail > .theme-toggle,
.has-shared-nav-rail .sidebar #themeToggleBtn,
.has-shared-nav-rail .sidebar-footer .theme-btn,
.has-shared-nav-rail .nav-actions .theme-toggle {
  display: none !important;
}
.shared-nav-right {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  width: 100%;
  min-width: 0;
}
.shared-nav-brand {
  display: grid;
  place-items: center;
  gap: 5px;
  width: 100%;
  padding-bottom: 16px;
  border-bottom: 1px solid rgba(255,255,255,.09);
  color: rgba(255,255,255,.68);
  font-size: 9px;
  font-weight: 700;
}
.shared-nav-brand-mark {
  display: grid;
  place-items: center;
  width: 43px;
  height: 43px;
  border: 1px solid rgba(201, 255, 71, 0.4);
  border-radius: 14px 5px 14px 5px;
  background: rgba(201, 255, 71, 0.08);
  color: var(--shared-nav-accent);
  font: 700 19px/1 'Space Grotesk', sans-serif;
  box-shadow: 0 0 24px rgba(201, 255, 71, 0.08);
}
.shared-nav-links {
  display: grid;
  gap: 5px;
  width: 100%;
  margin-top: 18px;
}
.shared-nav-link {
  --route-accent: var(--shared-nav-accent);
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-height: 68px;
  padding: 7px 4px;
  border: 1px solid transparent;
  border-radius: 14px;
  color: rgba(255,255,255,.43);
  text-decoration: none;
  transition: border-color .2s ease, background .2s ease, color .2s ease, transform .2s ease;
}
.shared-nav-link[data-page="finance"] { --route-accent: #66a1ff; }
.shared-nav-link[data-page="mortgage"] { --route-accent: #ff806b; }
.shared-nav-link[data-page="tax"] { --route-accent: #ad85ff; }
.shared-nav-link:hover {
  color: rgba(255,255,255,.9);
  background: rgba(255,255,255,.035);
  transform: translateX(-2px);
}
.shared-nav-link.active {
  color: rgba(255,255,255,.94);
  background: color-mix(in srgb, var(--route-accent) 9%, transparent);
  border-color: color-mix(in srgb, var(--route-accent) 23%, transparent);
}
.shared-nav-link.active::before {
  content: '';
  position: absolute;
  right: -11px;
  width: 3px;
  height: 28px;
  border-radius: 0 4px 4px 0;
  background: var(--route-accent);
  box-shadow: 0 0 14px color-mix(in srgb, var(--route-accent) 60%, transparent);
}
.shared-nav-icon {
  display: grid;
  place-items: center;
  width: 35px;
  height: 35px;
  border: 1px solid rgba(255,255,255,.09);
  border-radius: 11px;
  background: rgba(255,255,255,.025);
}
.shared-nav-icon svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.shared-nav-link.active .shared-nav-icon { color: var(--route-accent); border-color: color-mix(in srgb, var(--route-accent) 32%, transparent); }
.shared-nav-link-label { font-size: 10px; font-weight: 650; line-height: 1; }
.shared-nav-link::after {
  content: attr(data-tooltip);
  position: absolute;
  top: 50%;
  right: calc(100% + 12px);
  z-index: 5;
  width: max-content;
  max-width: 220px;
  padding: 8px 10px;
  border: 1px solid rgba(255,255,255,.12);
  border-radius: 9px;
  background: rgba(14,16,20,.97);
  color: rgba(255,255,255,.88);
  box-shadow: 0 14px 35px rgba(0,0,0,.35);
  font-size: 11px;
  opacity: 0;
  pointer-events: none;
  transform: translate(5px,-50%);
  transition: opacity .15s ease, transform .15s ease;
}
.shared-nav-link:hover::after, .shared-nav-link:focus-visible::after { opacity: 1; transform: translate(0,-50%); }
.shared-nav-link:focus-visible { outline: 2px solid var(--route-accent); outline-offset: 2px; }
.shared-nav-theme {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 100%;
  min-height: 58px;
  margin-top: 8px;
  padding: 6px 3px;
  border: 1px solid rgba(255,255,255,.09);
  border-radius: 13px;
  background: rgba(255,255,255,.025);
  color: rgba(255,255,255,.48);
  font: inherit;
  cursor: pointer;
  transition: color .2s ease, border-color .2s ease, background .2s ease;
}
.shared-nav-theme:hover { color: var(--shared-nav-accent); border-color: rgba(201,255,71,.28); background: rgba(201,255,71,.055); }
.shared-nav-theme .shared-nav-icon { width: 29px; height: 29px; border: 0; background: transparent; }
.shared-nav-theme-label { font-size: 9px; font-weight: 650; }
.shared-nav-user {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 44px;
  padding-top: 12px;
  border-top: 1px solid rgba(255,255,255,.09);
  color: rgba(255,255,255,.48);
}
.shared-nav-user img {
  width: 32px; height: 32px;
  border-radius: 50%;
  border: 1px solid rgba(201, 255, 71, 0.32);
}
.shared-nav-user > span:not([id]) { display: none; }
[data-theme="light"] .shared-nav {
  background: rgba(246,247,241,.9);
  border-left-color: rgba(5,10,14,.1);
  box-shadow: -14px 0 40px rgba(20,25,15,.06);
}
[data-theme="light"] .shared-nav-brand { color: rgba(10,14,8,.62); border-bottom-color: rgba(5,10,14,.1); }
[data-theme="light"] .shared-nav-link { color: rgba(10,14,8,.48); }
[data-theme="light"] .shared-nav-link:hover, [data-theme="light"] .shared-nav-link.active { color: rgba(10,14,8,.9); }
[data-theme="light"] .shared-nav-icon, [data-theme="light"] .shared-nav-user { border-color: rgba(5,10,14,.1); }
[data-theme="light"] .shared-nav-link::after { background: rgba(250,251,246,.98); color: #171914; border-color: rgba(5,10,14,.12); }
[data-theme="light"] .shared-nav-theme { color: rgba(10,14,8,.52); border-color: rgba(5,10,14,.1); background: rgba(5,10,14,.025); }
[data-theme="light"] .shared-nav-theme:hover { color: #6f9e00; border-color: rgba(111,158,0,.28); }
@media (max-width: 720px) {
  .has-shared-nav-rail { padding-right: 0 !important; padding-bottom: calc(76px + env(safe-area-inset-bottom)) !important; }
  /* Dock height (66px) + its own bottom offset — i.e. the dock's top edge. */
  .has-shared-nav-rail { --app-bottom-dock: calc(66px + max(8px, env(safe-area-inset-bottom))); }
  .shared-nav {
    top: auto;
    right: 9px;
    bottom: max(8px, env(safe-area-inset-bottom));
    left: 9px;
    width: auto;
    height: 66px;
    padding: 5px;
    border: 1px solid rgba(255,255,255,.14);
    border-radius: 18px;
    box-shadow: 0 18px 55px rgba(0,0,0,.42);
  }
  .shared-nav { flex-direction: row; }
  .shared-nav-right { display: block; flex: 1; }
  .shared-nav-brand, .shared-nav-user { display: none; }
  .shared-nav-links { grid-template-columns: repeat(5,1fr); gap: 3px; height: 100%; margin: 0; }
  .shared-nav-link { min-height: 0; height: 100%; padding: 4px 2px; border-radius: 12px; }
  .shared-nav-icon { width: 27px; height: 27px; border: 0; background: transparent; }
  .shared-nav-icon svg { width: 16px; height: 16px; }
  .shared-nav-link-label { font-size: 8.5px; }
  .shared-nav-link.active::before, .shared-nav-link::after { display: none; }
  .shared-nav-theme { width: 50px; min-height: 0; height: 100%; margin: 0 0 0 2px; padding: 3px 2px; border-color: transparent; background: transparent; }
  .shared-nav-theme .shared-nav-icon { width: 24px; height: 24px; }
  .shared-nav-theme-label { font-size: 8px; }
}
`;

/**
 * Injects the nav bar as the first element in <body>.
 * @param {string} currentPage - key of the current page (e.g. 'finance', 'tax')
 * @param {string} [syncSlotId='syncWidgetSlot'] - id for the sync widget slot
 */
export function injectNav(currentPage = '', syncSlotId = 'syncWidgetSlot') {
  // Apply the shared preference before painting the rail so moving between
  // HTML-first pages never flashes or silently resets the selected theme.
  try {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') document.documentElement.setAttribute('data-theme', 'light');
    if (savedTheme === 'dark') document.documentElement.removeAttribute('data-theme');
  } catch (_) {
    // Storage can be unavailable in privacy-restricted contexts; page defaults
    // remain a safe fallback.
  }

  const style = document.createElement('style');
  style.textContent = NAV_CSS;
  document.head.appendChild(style);

  const links = NAV_PAGES.map(({ href, label, title, key, icon }) => {
    const active = key === currentPage ? ' active' : '';
    const current = key === currentPage ? ' aria-current="page"' : '';
    return `<a class="shared-nav-link${active}" href="${href}" data-page="${key}" data-tooltip="${title}" aria-label="${title}"${current}>
      <span class="shared-nav-icon">${NAV_ICONS[icon]}</span>
      <span class="shared-nav-link-label">${label}</span>
    </a>`;
  }).join('');

  const nav = document.createElement('nav');
  nav.className = 'shared-nav';
  nav.setAttribute('aria-label', 'ניווט ראשי');
  nav.innerHTML = `
    <div class="shared-nav-right">
      <span class="shared-nav-brand"><span class="shared-nav-brand-mark">F</span><span>המעקב</span></span>
      <div class="shared-nav-links">${links}</div>
    </div>
    <button class="shared-nav-theme" id="shared-nav-theme" type="button" title="החלפת מצב תצוגה" aria-label="החלפת מצב תצוגה">
      <span class="shared-nav-icon">${NAV_ICONS.theme}</span>
      <span class="shared-nav-theme-label">תצוגה</span>
    </button>
    <div class="shared-nav-user" id="shared-nav-user">
      <span id="${syncSlotId}" style="display:inline-flex;margin-inline-end:6px;"></span>
    </div>
  `;

  document.body.insertBefore(nav, document.body.firstChild);
  document.body.classList.add('has-shared-nav-rail');

  const themeButton = nav.querySelector('#shared-nav-theme');
  const updateThemeButton = () => {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    themeButton.dataset.mode = isLight ? 'light' : 'dark';
    themeButton.setAttribute('aria-label', isLight ? 'לעבור למצב כהה' : 'לעבור למצב בהיר');
    themeButton.title = isLight ? 'מצב כהה' : 'מצב בהיר';
  };
  updateThemeButton();
  themeButton.addEventListener('click', () => {
    if (typeof window.toggleTheme === 'function') {
      window.toggleTheme();
    } else {
      const isLight = document.documentElement.getAttribute('data-theme') === 'light';
      const nextTheme = isLight ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', nextTheme);
      localStorage.setItem('theme', nextTheme);
      window.dispatchEvent(new CustomEvent('finance-theme-change', { detail: { theme: nextTheme } }));
    }
    window.requestAnimationFrame(updateThemeButton);
  });

  const schedulePrefetch = window.requestIdleCallback || (callback => window.setTimeout(callback, 350));
  schedulePrefetch(() => {
    NAV_PAGES.filter(page => page.key !== currentPage).forEach(page => {
      if (document.head.querySelector(`link[rel="prefetch"][href="${page.href}"]`)) return;
      const hint = document.createElement('link');
      hint.rel = 'prefetch';
      hint.as = 'document';
      hint.href = page.href;
      document.head.appendChild(hint);
    });
  });

  return nav;
}

/**
 * Injects the unified demo-mode banner right below the shared nav
 * (one component instead of four per-page styles — Phase 4b #14).
 */
export function injectDemoBanner(text = '👁️ מצב הדגמה — נתונים פיקטיביים לקריאה בלבד') {
  if (document.getElementById('shared-demo-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'shared-demo-banner';
  banner.textContent = text;
  banner.style.cssText =
    'background: hsla(45, 100%, 60%, 0.08); border: 1px solid hsla(45, 100%, 60%, 0.35);' +
    'color: hsl(45, 90%, 62%); padding: 9px 16px; border-radius: 10px;' +
    'font-size: 0.85rem; font-weight: 600; text-align: center; margin: 10px 16px;' +
    'direction: rtl; width: calc(100% - 32px); box-sizing: border-box;';
  const nav = document.querySelector('.shared-nav');
  if (nav) nav.insertAdjacentElement('afterend', banner);
  else document.body.insertBefore(banner, document.body.firstChild);
  if (getComputedStyle(document.body).display.includes('flex')) {
    banner.style.flexBasis = '100%';
  }
  return banner;
}

/**
 * Populates the user section of the nav bar.
 * @param {object} user - Firebase user or demo user object
 */
export function setNavUser(user) {
  const el = document.getElementById('shared-nav-user');
  if (!el || !user) return;
  // Keep the sync slot (first child) — replace only the avatar/name part
  el.querySelectorAll('img, span:not([id])').forEach(n => n.remove());
  if (user.photoURL) {
    const img = document.createElement('img');
    img.src = user.photoURL;
    img.alt = '';
    img.addEventListener('error', () => img.remove());
    el.appendChild(img);
  }
  const name = document.createElement('span');
  name.textContent = user.displayName || user.email || '';
  el.appendChild(name);
}
