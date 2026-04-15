// Shared sync status widget for finance-tracker pages.
//
// Provides a small button (rendered into a configurable container) that shows
// the current sync state — synced / syncing / pending / error / local-only —
// and lets the user trigger a manual sync. Also persists a meta record in
// localStorage so that load functions can detect "local has unsynced changes
// newer than cloud" and avoid wiping them out on refresh.
//
// Each page that uses this module owns a separate metaKey so the pages don't
// interfere with each other.
//
// Usage:
//   SyncWidget.init({
//     containerId: 'syncWidgetSlot',  // element to append the button into
//     metaKey: 'portfolio_sync_meta',  // localStorage key for sync meta
//     isDemoMode: () => _isDemoMode,   // optional, hides widget in demo
//     onForceSync: async () => { ... } // called when user clicks the widget
//   });
//
//   SyncWidget.markSyncing();
//   SyncWidget.markSynced();
//   SyncWidget.markError();
//   SyncWidget.markPending();
//   SyncWidget.markLocalOnly();
//
//   // In load function, before overwriting local data:
//   if (SyncWidget.shouldPreserveLocal(cloudLastModified)) {
//     // load local instead, then push to cloud
//   }

(function(global) {
    'use strict';

    const STATES = {
        'loading':    { icon: '⏳', label: 'טוען...',          color: '#6b7280', bg: 'rgba(107,114,128,0.10)' },
        'synced':     { icon: '✅', label: 'מסונכרן',          color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
        'syncing':    { icon: '🔄', label: 'מסנכרן...',        color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
        'pending':    { icon: '🟡', label: 'ממתין לסנכרון',    color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
        'error':      { icon: '⚠️', label: 'שגיאה בסנכרון',    color: '#ef4444', bg: 'rgba(239,68,68,0.15)' },
        'local-only': { icon: '📴', label: 'מקומי בלבד',       color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' }
    };

    const SyncWidget = {
        config: null,
        button: null,
        iconEl: null,
        labelEl: null,
        state: {
            status: 'loading',
            dataSource: null,
            lastSyncTime: null
        },

        init(config) {
            this.config = Object.assign({
                containerId: 'syncWidgetSlot',
                metaKey: 'sync_meta',
                isDemoMode: () => false,
                onForceSync: null
            }, config || {});

            this._render();
            this._setupOnlineListener();
            this._update();
        },

        _render() {
            const container = document.getElementById(this.config.containerId);
            if (!container) {
                console.warn('SyncWidget: container not found:', this.config.containerId);
                return;
            }

            // Avoid double-render
            if (this.button && container.contains(this.button)) return;

            const btn = document.createElement('button');
            btn.id = 'syncWidget';
            btn.type = 'button';
            btn.style.cssText = [
                'display:inline-flex', 'align-items:center', 'gap:6px',
                'padding:8px 12px', 'border-radius:10px',
                'border:1px solid #374151', 'background:#1e293b',
                'cursor:pointer', 'font-size:13px', 'font-weight:500',
                'color:#e5e7eb', 'transition:all .2s', 'min-width:140px',
                'justify-content:center', 'white-space:nowrap',
                'font-family:inherit'
            ].join(';');

            const iconEl = document.createElement('span');
            iconEl.id = 'syncWidgetIcon';
            const labelEl = document.createElement('span');
            labelEl.id = 'syncWidgetLabel';
            btn.appendChild(iconEl);
            btn.appendChild(labelEl);

            btn.addEventListener('click', () => this.forceSync());

            container.appendChild(btn);
            this.button = btn;
            this.iconEl = iconEl;
            this.labelEl = labelEl;
        },

        _update() {
            if (!this.button) return;

            // Hide widget in demo mode
            if (this.config.isDemoMode && this.config.isDemoMode()) {
                this.button.style.display = 'none';
                return;
            }
            this.button.style.display = 'inline-flex';

            const s = STATES[this.state.status] || STATES['loading'];
            this.iconEl.textContent = s.icon;
            this.labelEl.textContent = s.label;
            this.button.style.borderColor = s.color;
            this.button.style.color = s.color;
            this.button.style.background = s.bg;

            const tipLines = [];
            if (this.state.dataSource === 'cloud') tipLines.push('נטען מהענן (Firebase)');
            else if (this.state.dataSource === 'local') tipLines.push('נטען ממאגר מקומי (localStorage)');
            if (this.state.lastSyncTime) {
                try { tipLines.push('סנכרון אחרון: ' + new Date(this.state.lastSyncTime).toLocaleString('he-IL')); } catch(e) {}
            }
            const meta = this.getMeta();
            if (meta && meta.hasUnsyncedChanges) tipLines.push('יש שינויים מקומיים שטרם סונכרנו');
            tipLines.push('לחץ כדי לסנכרן עכשיו');
            this.button.title = tipLines.join('\n');
        },

        getMeta() {
            try {
                const raw = localStorage.getItem(this.config.metaKey);
                return raw ? JSON.parse(raw) : null;
            } catch(e) { return null; }
        },

        setMeta(meta) {
            try { localStorage.setItem(this.config.metaKey, JSON.stringify(meta)); } catch(e) {}
        },

        // Returns true when local has unsynced changes whose timestamp is
        // newer than the cloud's lastModified — caller should preserve local
        // and push it instead of overwriting with cloud data.
        shouldPreserveLocal(cloudLastModified) {
            const meta = this.getMeta();
            return !!(meta && meta.hasUnsyncedChanges && meta.localLastModified &&
                      (!cloudLastModified || meta.localLastModified > cloudLastModified));
        },

        markSyncing() {
            this.state.status = 'syncing';
            this._update();
        },

        markSynced(lastSyncTime) {
            const ts = lastSyncTime || new Date().toISOString();
            this.state.status = 'synced';
            this.state.dataSource = 'cloud';
            this.state.lastSyncTime = ts;
            this.setMeta({
                localLastModified: ts,
                cloudLastModified: ts,
                hasUnsyncedChanges: false
            });
            this._update();
        },

        markError() {
            this.state.status = 'error';
            const prev = this.getMeta() || {};
            this.setMeta({
                localLastModified: new Date().toISOString(),
                cloudLastModified: prev.cloudLastModified || null,
                hasUnsyncedChanges: true
            });
            this._update();
        },

        markPending() {
            this.state.status = 'pending';
            const prev = this.getMeta() || {};
            this.setMeta({
                localLastModified: new Date().toISOString(),
                cloudLastModified: prev.cloudLastModified || null,
                hasUnsyncedChanges: true
            });
            this._update();
        },

        markLocalOnly() {
            this.state.status = 'local-only';
            this.state.dataSource = 'local';
            const meta = this.getMeta();
            if (meta && meta.hasUnsyncedChanges) {
                this.state.status = 'pending';
                this.state.lastSyncTime = meta.cloudLastModified || null;
            } else {
                this.state.lastSyncTime = meta ? (meta.cloudLastModified || null) : null;
            }
            this._update();
        },

        markLoadedFromCloud(cloudLastModified) {
            this.state.dataSource = 'cloud';
            this.state.status = 'synced';
            this.state.lastSyncTime = cloudLastModified || new Date().toISOString();
            this.setMeta({
                localLastModified: this.state.lastSyncTime,
                cloudLastModified: this.state.lastSyncTime,
                hasUnsyncedChanges: false
            });
            this._update();
        },

        async forceSync() {
            if (this.config.isDemoMode && this.config.isDemoMode()) {
                this._notify('מצב הדגמה - אין סנכרון');
                return;
            }
            if (!navigator.onLine) {
                this._notify('⚠️ אין חיבור לאינטרנט');
                return;
            }
            if (this.state.status === 'syncing') return;
            if (typeof this.config.onForceSync !== 'function') {
                console.warn('SyncWidget: no onForceSync callback configured');
                return;
            }
            this._notify('🔄 מסנכרן...');
            try {
                await this.config.onForceSync();
                if (this.state.status === 'synced') {
                    this._notify('✅ הנתונים סונכרנו בהצלחה');
                }
            } catch(e) {
                console.error('SyncWidget force sync failed:', e);
                this.markError();
                this._notify('❌ שגיאה בסנכרון');
            }
        },

        _setupOnlineListener() {
            window.addEventListener('online', () => {
                const meta = this.getMeta();
                if (meta && meta.hasUnsyncedChanges &&
                    !(this.config.isDemoMode && this.config.isDemoMode())) {
                    setTimeout(() => {
                        console.log('🔄 SyncWidget: auto-retry after reconnect');
                        this.forceSync();
                    }, 1500);
                } else {
                    this._update();
                }
            });
            window.addEventListener('offline', () => this._update());
        },

        // Best-effort notification: prefer existing app notify(); fall back to a
        // tiny floating toast injected into the DOM.
        _notify(msg) {
            if (typeof global.notify === 'function') {
                try { global.notify(msg); return; } catch(e) {}
            }
            if (typeof global.showToast === 'function') {
                try { global.showToast(msg); return; } catch(e) {}
            }
            // Fallback floating toast
            let toast = document.getElementById('__syncWidgetToast');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = '__syncWidgetToast';
                toast.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1e293b;color:#e5e7eb;padding:10px 16px;border-radius:8px;border:1px solid #374151;font-size:14px;z-index:10000;opacity:0;transition:opacity .2s;pointer-events:none;';
                document.body.appendChild(toast);
            }
            toast.textContent = msg;
            toast.style.opacity = '1';
            clearTimeout(toast.__t);
            toast.__t = setTimeout(() => { toast.style.opacity = '0'; }, 2500);
        }
    };

    global.SyncWidget = SyncWidget;
})(typeof window !== 'undefined' ? window : this);
