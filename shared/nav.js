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
  { href: 'app.html#/home',     label: 'דף ראשי',     title: 'מרכז השליטה',       key: 'index' },
  { href: 'portfolio.html',     label: 'תיק השקעות',  title: 'תיק השקעות',       key: 'portfolio' },
  { href: 'finance.html',       label: 'מעקב כספי',   title: 'מעקב כספי',        key: 'finance' },
  { href: 'mortgage.html',      label: 'משכנתא',      title: 'מחשבון משכנתא',    key: 'mortgage' },
  { href: 'tax-optimizer.html', label: 'מס',          title: 'אופטימיזציית מס',  key: 'tax' },
];

const NAV_CSS = `
.shared-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  box-sizing: border-box;
  padding: 11px 18px;
  background: rgba(8, 9, 12, 0.9);
  border-bottom: 1px solid rgba(255, 255, 255, 0.09);
  position: sticky;
  top: 0;
  z-index: 100;
  backdrop-filter: blur(24px);
  box-shadow: 0 14px 45px rgba(0, 0, 0, 0.18);
  direction: rtl;
  /* Same name on every page, so a cross-document view transition treats this as
     one continuous element and skips it entirely instead of cross-fading it.
     This is what keeps the chrome still while the content changes. */
  view-transition-name: app-nav;
}
.shared-nav-right {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}
.shared-nav-brand {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 0.86rem;
  font-weight: 700;
  color: var(--text-primary, hsl(210, 20%, 92%));
  white-space: nowrap;
}
.shared-nav-brand::before {
  content: 'F';
  display: grid;
  place-items: center;
  width: 29px; height: 29px;
  border: 1px solid rgba(201, 255, 71, 0.38);
  border-radius: 9px 3px 9px 3px;
  background: rgba(201, 255, 71, 0.08);
  color: #c9ff47;
  font: 700 13px/1 'Space Grotesk', sans-serif;
  box-shadow: 0 0 20px rgba(201, 255, 71, 0.08);
}
.shared-nav-brand::after {
  content: 'FINANCIAL OS';
  margin-inline-start: 2px;
  color: rgba(255, 255, 255, 0.32);
  font: 600 7px/1 'Space Grotesk', sans-serif;
  letter-spacing: 0.13em;
  direction: ltr;
}
.shared-nav-links {
  display: flex;
  gap: 4px;
  align-items: center;
  flex-wrap: wrap;
}
.shared-nav-links a {
  padding: 7px 14px;
  border-radius: 10px;
  font-size: 0.8rem;
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
  color: var(--text-muted, hsl(215, 12%, 52%));
  border: 1px solid transparent;
  transition: all 0.2s;
}
.shared-nav-links a:hover {
  color: var(--text-primary, hsl(210, 20%, 92%));
  background: var(--bg-elevated, hsl(220, 16%, 15%));
}
.shared-nav-links a.active {
  color: #c9ff47;
  background: rgba(201, 255, 71, 0.08);
  border-color: rgba(201, 255, 71, 0.26);
}
.shared-nav-user {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-muted, hsl(215, 12%, 52%));
  white-space: nowrap;
}
.shared-nav-user img {
  width: 28px; height: 28px;
  border-radius: 50%;
  border: 1px solid rgba(201, 255, 71, 0.32);
}
[data-theme="light"] .shared-nav {
  background: rgba(250, 251, 246, 0.92);
  border-bottom-color: rgba(5, 10, 14, 0.11);
  box-shadow: 0 14px 40px rgba(20, 25, 15, 0.08);
}
[data-theme="light"] .shared-nav-brand::after {
  color: rgba(10, 14, 8, 0.38);
}
@media (max-width: 640px) {
  .shared-nav { padding: 8px 10px; }
  .shared-nav-brand { display: none; }
  .shared-nav-links a { padding: 5px 10px; font-size: 0.8rem; }
}
`;

/**
 * Injects the nav bar as the first element in <body>.
 * @param {string} currentPage - key of the current page (e.g. 'finance', 'tax')
 * @param {string} [syncSlotId='syncWidgetSlot'] - id for the sync widget slot
 */
export function injectNav(currentPage = '', syncSlotId = 'syncWidgetSlot') {
  const style = document.createElement('style');
  style.textContent = NAV_CSS;
  document.head.appendChild(style);

  const links = NAV_PAGES.map(({ href, label, title, key }) => {
    const active = key === currentPage ? ' class="active"' : '';
    return `<a href="${href}" title="${title}"${active}>${label}</a>`;
  }).join('');

  const nav = document.createElement('nav');
  nav.className = 'shared-nav';
  nav.innerHTML = `
    <div class="shared-nav-right">
      <span class="shared-nav-brand">המעקב</span>
      <div class="shared-nav-links">${links}</div>
    </div>
    <div class="shared-nav-user" id="shared-nav-user">
      <span id="${syncSlotId}" style="display:inline-flex;margin-inline-end:6px;"></span>
    </div>
  `;

  document.body.insertBefore(nav, document.body.firstChild);

  // Some pages lay out <body> as a centered flex row (e.g. index.html) —
  // without this the nav is squeezed in as a flex item BESIDE the content.
  const bodyDisplay = getComputedStyle(document.body).display;
  if (bodyDisplay.includes('flex')) {
    document.body.style.flexWrap = 'wrap';
    document.body.style.alignContent = 'flex-start';
    nav.style.flexBasis = '100%';
  }

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
