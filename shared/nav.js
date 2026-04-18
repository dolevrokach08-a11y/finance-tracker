/**
 * Shared navigation bar component.
 * Usage: import { injectNav, setNavUser } from './shared/nav.js';
 *        injectNav('finance');   // pass current page key
 *        setNavUser(user);       // call after auth resolves
 */

const NAV_PAGES = [
  { href: 'index.html',         icon: '🏠', title: 'דף ראשי',          key: 'index' },
  { href: 'finance.html',       icon: '💵', title: 'מעקב כספי',         key: 'finance' },
  { href: 'portfolio.html',     icon: '📈', title: 'תיק השקעות',        key: 'portfolio' },
  { href: 'mortgage.html',      icon: '🏡', title: 'מחשבון משכנתא',     key: 'mortgage' },
  { href: 'tax-optimizer.html', icon: '🧮', title: 'אופטימיזציית מס',   key: 'tax' },
];

const NAV_CSS = `
.shared-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: hsla(220, 18%, 10%, 0.95);
  border-bottom: 1px solid hsl(220, 14%, 16%);
  position: sticky;
  top: 0;
  z-index: 100;
  backdrop-filter: blur(10px);
}
.shared-nav-links {
  display: flex;
  gap: 8px;
  align-items: center;
}
.shared-nav-links a {
  width: 36px; height: 36px;
  border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px;
  text-decoration: none;
  color: hsl(215, 12%, 52%);
  border: 1px solid hsl(220, 14%, 16%);
  background: hsl(220, 16%, 13%);
  transition: all 0.2s;
}
.shared-nav-links a:hover,
.shared-nav-links a.active {
  background: hsl(220, 16%, 18%);
  color: hsl(210, 20%, 92%);
  border-color: hsla(142, 60%, 50%, 0.3);
}
.shared-nav-user {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: hsl(215, 12%, 52%);
}
.shared-nav-user img {
  width: 28px; height: 28px;
  border-radius: 50%;
  border: 1px solid hsla(142, 60%, 50%, 0.4);
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

  const links = NAV_PAGES.map(({ href, icon, title, key }) => {
    const active = key === currentPage ? ' class="active"' : '';
    return `<a href="${href}" title="${title}"${active}>${icon}</a>`;
  }).join('');

  const nav = document.createElement('nav');
  nav.className = 'shared-nav';
  nav.innerHTML = `
    <div class="shared-nav-links">
      ${links}
      <span id="${syncSlotId}" style="display:inline-flex;margin-inline-start:6px;"></span>
    </div>
    <div class="shared-nav-user" id="shared-nav-user"></div>
  `;

  document.body.insertBefore(nav, document.body.firstChild);
  return nav;
}

/**
 * Populates the user section of the nav bar.
 * @param {object} user - Firebase user or demo user object
 */
export function setNavUser(user) {
  const el = document.getElementById('shared-nav-user');
  if (!el || !user) return;
  const avatar = user.photoURL
    ? `<img src="${user.photoURL}" alt="">`
    : '';
  el.innerHTML = `${avatar}<span>${user.displayName || user.email || ''}</span>`;
}
