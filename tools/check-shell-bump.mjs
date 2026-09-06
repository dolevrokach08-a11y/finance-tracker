/**
 * Deploy gate: a shell change without a SHELL_CACHE bump fails.
 *
 * main deploys straight to GitHub Pages, and the service worker purges the old
 * shell cache by NAME. Ship changed HTML/JS/CSS under the same cache name and
 * the worker keeps serving the previous bytes from the cache it still considers
 * current — the deploy is live on the server and invisible in the browser.
 *
 * This used to be a `::warning` in checks.yml. A warning does not stop a merge,
 * and the one failure mode the whole cache-naming scheme exists to prevent was
 * therefore unenforced. It is an error now.
 *
 * The verdict function takes plain data so it can be tested without a git repo;
 * the CLI is the thin part that asks git for that data.
 *
 *   node tools/check-shell-bump.mjs [<base-ref>]     # default: HEAD~1
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/**
 * Paths whose bytes the service worker can serve out of SHELL_CACHE.
 *
 * Deliberately NOT here:
 *   - sw.js itself. The browser revalidates the worker script outside any
 *     cache, and editing it is how you bump — requiring a bump to edit it
 *     would be circular.
 *   - data/. `data/boi-mortgage-rates.json` is precached, but it is rewritten
 *     by an unattended monthly workflow that commits to main; failing that run
 *     would break the refresh to protect a file the runtime handler already
 *     revalidates (stale-while-revalidate) on every visit.
 *   - tests/, tools/, worker/, scripts/, agents/, docs/, design/, .github/ —
 *     none of them ship to the browser.
 */
const SHELL_PATTERNS = [
  /^[^/]+\.html$/,
  /^app\//,
  /^shared\//,
  /^icons\//,
  /^manifest\.json$/,
  /^shared-theme\.css$/,
  /^finance\.tailwind\.css$/,
  // Root-level scripts the pages load directly.
  /^(ai-assistant|demo-data|firebase-config|sync-widget|terms-modal|ticker|tax-optimizer\.app)\.js$/,
];

export function isShellPath(path) {
  return SHELL_PATTERNS.some(re => re.test(path));
}

export function shellCacheName(source) {
  const m = /const\s+SHELL_CACHE\s*=\s*['"]([^'"]+)['"]/.exec(String(source || ''));
  return m ? m[1] : null;
}

/**
 * @param {object} input
 * @param {string[]} input.changed   paths changed between base and head
 * @param {string} input.baseSw      sw.js as it is at the base commit
 * @param {string} input.headSw      sw.js as it is now
 * @returns {{ok: boolean, reason: string, shellChanged: string[], from: string|null, to: string|null}}
 */
export function shellBumpVerdict({ changed = [], baseSw = '', headSw = '' } = {}) {
    const shellChanged = changed.filter(isShellPath);
    const from = shellCacheName(baseSw);
    const to = shellCacheName(headSw);

    if (!to) {
        return { ok: false, reason: 'sw.js has no SHELL_CACHE constant to check', shellChanged, from, to };
    }
    if (shellChanged.length === 0) {
        return { ok: true, reason: 'no shell files changed', shellChanged, from, to };
    }
    // A base with no readable sw.js (a fresh repo, a shallow fetch that came up
    // empty) must not be read as "unchanged" — that would pass the gate exactly
    // when it knows least.
    if (!from) {
        return { ok: false, reason: 'could not read SHELL_CACHE at the base commit', shellChanged, from, to };
    }
    if (from === to) {
        return {
            ok: false,
            reason: `shell files changed but SHELL_CACHE is still ${to}`,
            shellChanged, from, to,
        };
    }
    return { ok: true, reason: `SHELL_CACHE bumped ${from} → ${to}`, shellChanged, from, to };
}

// ── CLI ────────────────────────────────────────────────────────────────────
const invokedDirectly = !!process.argv[1]
    && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
    const base = process.argv[2] || 'HEAD~1';
    const git = (...args) => {
        try {
            return execFileSync('git', args, { encoding: 'utf8' });
        } catch {
            return '';
        }
    };

    const changed = git('diff', '--name-only', base, 'HEAD').split('\n').map(s => s.trim()).filter(Boolean);
    const verdict = shellBumpVerdict({
        changed,
        baseSw: git('show', `${base}:sw.js`),
        headSw: git('show', 'HEAD:sw.js'),
    });

    if (verdict.ok) {
        console.log(`✓ shell cache gate: ${verdict.reason}`);
        process.exit(0);
    }
    console.error(`::error file=sw.js::${verdict.reason}`);
    console.error('Shell files in this change:');
    verdict.shellChanged.forEach(f => console.error('  ' + f));
    console.error('');
    console.error('Bump SHELL_CACHE in sw.js. Without it the service worker keeps');
    console.error('serving the previous bytes and the deploy never reaches the browser.');
    process.exit(1);
}
