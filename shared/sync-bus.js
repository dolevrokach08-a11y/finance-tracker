/**
 * Cross-page sync bus using localStorage storage events.
 * When one tab saves data, other open tabs react automatically.
 *
 * Usage:
 *   import { SyncBus } from './shared/sync-bus.js';
 *   SyncBus.subscribe((manifest) => { ... });
 *   SyncBus.publish('portfolio', { changed: ['holdings', 'cash'] });
 */

const MANIFEST_KEY = 'ft_sync_manifest';
const WARNINGS_KEY = 'ft_warnings';

export const SyncBus = {
  /**
   * Announce that this page just saved data.
   * @param {'portfolio'|'finance'|'mortgage'|'tax'} source
   * @param {object} summary - what changed, e.g. { changed: ['holdings'] }
   */
  publish(source, summary = {}) {
    const manifest = {
      source,
      timestamp: Date.now(),
      summary,
    };
    localStorage.setItem(MANIFEST_KEY, JSON.stringify(manifest));
  },

  /**
   * Listen for saves from other tabs/pages.
   * @param {(manifest: {source: string, timestamp: number, summary: object}) => void} callback
   * @returns {() => void} unsubscribe function
   */
  subscribe(callback) {
    const handler = (e) => {
      if (e.key === MANIFEST_KEY && e.newValue) {
        try {
          callback(JSON.parse(e.newValue));
        } catch { /* ignore parse errors */ }
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  },

  /**
   * Post a cross-page warning (e.g. expense spike → mortgage affordability).
   * @param {string} type - warning type identifier
   * @param {object} data - warning payload
   */
  warn(type, data) {
    const warnings = SyncBus.getWarnings();
    warnings[type] = { ...data, timestamp: Date.now() };
    localStorage.setItem(WARNINGS_KEY, JSON.stringify(warnings));
  },

  /**
   * Read all active warnings.
   * @returns {object} keyed by warning type
   */
  getWarnings() {
    try {
      return JSON.parse(localStorage.getItem(WARNINGS_KEY) || '{}');
    } catch {
      return {};
    }
  },

  /**
   * Clear a specific warning.
   * @param {string} type
   */
  clearWarning(type) {
    const warnings = SyncBus.getWarnings();
    delete warnings[type];
    localStorage.setItem(WARNINGS_KEY, JSON.stringify(warnings));
  },

  /**
   * Read the last sync manifest (useful on page load to check freshness).
   * @returns {object|null}
   */
  getLastManifest() {
    try {
      return JSON.parse(localStorage.getItem(MANIFEST_KEY));
    } catch {
      return null;
    }
  },
};
