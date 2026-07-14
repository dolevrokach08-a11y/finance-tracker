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
  { href: 'index.html',         label: 'דף ראשי',     title: 'דף ראשי',          key: 'index' },
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
  padding: 10px 18px;
  background: var(--bg-surface, hsla(220, 18%, 10%, 0.95));
  border-bottom: 1px solid var(--border, hsl(220, 14%, 16%));
  position: sticky;
  top: 0;
  z-index: 100;
  backdrop-filter: blur(10px);
  direction: rtl;
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
  gap: 7px;
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--text-primary, hsl(210, 20%, 92%));
  white-space: nowrap;
}
.shared-nav-brand::before {
  content: '';
  width: 8px; height: 8px;
  border-radius: 50%;
  background: hsl(142, 60%, 50%);
  box-shadow: 0 0 6px hsla(142, 60%, 50%, 0.7);
}
.shared-nav-links {
  display: flex;
  gap: 4px;
  align-items: center;
  flex-wrap: wrap;
}
.shared-nav-links a {
  padding: 6px 14px;
  border-radius: 9px;
  font-size: 0.85rem;
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
  color: hsl(142, 60%, 55%);
  background: hsla(142, 60%, 50%, 0.1);
  border-color: hsla(142, 60%, 50%, 0.35);
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
  border: 1px solid hsla(142, 60%, 50%, 0.4);
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
      <span class="shared-nav-brand">המעקב הפיננסי</span>
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
