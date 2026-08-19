import assert from 'node:assert/strict';

class MemoryStorage {
    constructor(seed = {}) { this.map = new Map(Object.entries(seed)); }
    getItem(key) { return this.map.has(String(key)) ? this.map.get(String(key)) : null; }
    setItem(key, value) { this.map.set(String(key), String(value)); }
    removeItem(key) { this.map.delete(String(key)); }
    clear() { this.map.clear(); }
}

globalThis.window = {};
Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'Demo isolation test' },
    configurable: true,
});
globalThis.localStorage = new MemoryStorage();
globalThis.sessionStorage = new MemoryStorage();

await import('../shared/user-storage.js');
const { enterDemoMode, exitDemoMode } = await import('../demo-data.js');

function reset(seed = {}) {
    globalThis.localStorage = new MemoryStorage(seed.local);
    globalThis.sessionStorage = new MemoryStorage(seed.session);
}

// A known signed-in user's plain cache is archived before demo data is seeded.
reset({
    local: {
        ft_active_uid: 'real-user-1',
        portfolio: JSON.stringify({ secret: 'real portfolio' }),
        financeTrackerData: JSON.stringify({ secret: 'real finance' }),
    },
});
enterDemoMode();
assert.equal(sessionStorage.getItem('demoMode'), 'true');
assert.equal(localStorage.getItem('ft_active_uid'), 'demo-user-readonly');
assert.equal(JSON.parse(localStorage.getItem('u::real-user-1::portfolio')).secret, 'real portfolio');
assert.notEqual(JSON.parse(localStorage.getItem('portfolio')).secret, 'real portfolio');
assert.ok(JSON.parse(localStorage.getItem('portfolio')).holdings.length > 0);
assert.ok(JSON.parse(localStorage.getItem('financeTrackerData')).transactions.length > 0);

exitDemoMode();
assert.equal(localStorage.getItem('portfolio'), null);
assert.equal(localStorage.getItem('financeTrackerData'), null);
assert.equal(localStorage.getItem('ft_active_uid'), null);
window.UserStorage.syncToUser('real-user-1');
assert.equal(JSON.parse(localStorage.getItem('portfolio')).secret, 'real portfolio');
assert.equal(JSON.parse(localStorage.getItem('financeTrackerData')).secret, 'real finance');

// Legacy data without an owner marker is quarantined, never adopted by demo,
// and recovered into the first real account that signs in afterwards.
reset({ local: { portfolio: JSON.stringify({ secret: 'legacy portfolio' }) } });
enterDemoMode();
assert.equal(localStorage.getItem('ft_active_uid'), 'demo-user-readonly');
assert.notEqual(JSON.parse(localStorage.getItem('portfolio')).secret, 'legacy portfolio');
exitDemoMode();
window.UserStorage.syncToUser('real-user-2');
assert.equal(JSON.parse(localStorage.getItem('portfolio')).secret, 'legacy portfolio');

console.log('Demo isolation tests passed.');
