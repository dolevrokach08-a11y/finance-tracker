/**
 * AI Financial Assistant Module
 *
 * Provides a floating chat interface that analyzes financial data
 * using Claude API with Tool Use for natural language queries.
 *
 * Falls back to local analysis when API key is not configured.
 */

// ==================== AI ASSISTANT COMPONENT ====================

class FinancialAIAssistant {
    constructor(options = {}) {
        this.apiKey = options.apiKey || localStorage.getItem('ai_api_key') || null;
        // Default to claude-sonnet-4-5 (stable alias). If the user previously
        // saved an invalid name like 'claude-sonnet-4-6' we silently upgrade.
        const stored = localStorage.getItem('ai_model');
        const invalidLegacy = stored === 'claude-sonnet-4-6';
        this.model = options.model || (invalidLegacy ? null : stored) || 'claude-sonnet-4-5';
        this.getFinanceData = options.getFinanceData || (() => ({}));
        this.getPortfolioData = options.getPortfolioData || (() => ({}));
        this.isOpen = false;
        this.messages = [];
        this.isTyping = false;
        this.container = null;
        this.settingsOpen = false;
        this.onAction = options.onAction || (() => {});

        this._injectStyles();
        this._createDOM();
        this._bindEvents();
    }

    // ---- Styles ----
    _injectStyles() {
        if (document.getElementById('ai-assistant-styles')) return;
        const style = document.createElement('style');
        style.id = 'ai-assistant-styles';
        style.textContent = `
            .ai-fab {
                position: fixed;
                bottom: 24px;
                left: 24px;
                width: 56px;
                height: 56px;
                border-radius: 50%;
                background: linear-gradient(135deg, hsl(142, 60%, 45%), hsl(180, 60%, 40%));
                border: none;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 4px 20px hsla(142, 60%, 50%, 0.35);
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                z-index: 10000;
                color: white;
                font-size: 24px;
            }
            .ai-fab:hover {
                transform: scale(1.08);
                box-shadow: 0 6px 28px hsla(142, 60%, 50%, 0.5);
            }
            .ai-fab.active {
                transform: scale(0.9) rotate(90deg);
                background: hsl(0, 72%, 55%);
                box-shadow: 0 4px 20px hsla(0, 72%, 55%, 0.35);
            }
            .ai-fab-badge {
                position: absolute;
                top: -2px;
                right: -2px;
                width: 16px;
                height: 16px;
                border-radius: 50%;
                background: hsl(38, 80%, 50%);
                border: 2px solid hsl(220, 20%, 7%);
                animation: ai-pulse 2s infinite;
            }
            @keyframes ai-pulse {
                0%, 100% { opacity: 1; transform: scale(1); }
                50% { opacity: 0.7; transform: scale(1.15); }
            }

            .ai-chat-panel {
                position: fixed;
                bottom: 92px;
                left: 24px;
                width: 400px;
                max-height: 560px;
                border-radius: 16px;
                background: hsl(220, 18%, 10%);
                border: 1px solid hsl(220, 14%, 18%);
                box-shadow: 0 16px 48px rgba(0,0,0,0.5);
                display: flex;
                flex-direction: column;
                z-index: 10001;
                opacity: 0;
                transform: translateY(16px) scale(0.95);
                pointer-events: none;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                overflow: hidden;
            }
            .ai-chat-panel.open {
                opacity: 1;
                transform: translateY(0) scale(1);
                pointer-events: auto;
            }

            .ai-chat-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 16px 20px;
                border-bottom: 1px solid hsl(220, 14%, 16%);
                background: hsl(220, 16%, 12%);
            }
            .ai-chat-header-title {
                display: flex;
                align-items: center;
                gap: 10px;
                color: hsl(210, 20%, 92%);
                font-weight: 600;
                font-size: 0.95rem;
            }
            .ai-chat-header-title svg {
                width: 20px;
                height: 20px;
                color: hsl(142, 60%, 50%);
            }
            .ai-chat-status {
                font-size: 0.7rem;
                color: hsl(142, 60%, 50%);
                display: flex;
                align-items: center;
                gap: 6px;
            }
            .ai-chat-status::before {
                content: '';
                width: 6px;
                height: 6px;
                border-radius: 50%;
                background: hsl(142, 60%, 50%);
                display: inline-block;
            }
            .ai-chat-status.connected { color: hsl(142, 60%, 50%); }
            .ai-chat-status.connected::before { background: hsl(142, 60%, 50%); }
            .ai-chat-status.local { color: hsl(38, 80%, 55%); }
            .ai-chat-status.local::before { background: hsl(38, 80%, 55%); }

            .ai-settings-btn {
                background: transparent;
                border: none;
                color: hsl(215, 12%, 50%);
                cursor: pointer;
                padding: 4px;
                border-radius: 6px;
                transition: all 0.2s;
                display: flex;
                align-items: center;
            }
            .ai-settings-btn:hover { color: hsl(210, 20%, 85%); background: hsl(220, 16%, 16%); }

            .ai-settings-panel {
                padding: 16px;
                border-bottom: 1px solid hsl(220, 14%, 16%);
                background: hsl(220, 16%, 9%);
                display: none;
                animation: ai-msg-in 0.2s ease both;
            }
            .ai-settings-panel.open { display: block; }
            .ai-settings-panel label {
                display: block;
                font-size: 0.75rem;
                color: hsl(215, 12%, 52%);
                margin-bottom: 6px;
                direction: rtl;
            }
            .ai-settings-panel input,
            .ai-settings-panel select {
                width: 100%;
                background: hsl(220, 16%, 13%);
                border: 1px solid hsl(220, 14%, 20%);
                border-radius: 8px;
                padding: 8px 12px;
                color: hsl(210, 20%, 92%);
                font-size: 0.8rem;
                font-family: inherit;
                outline: none;
                margin-bottom: 12px;
                direction: ltr;
                transition: border-color 0.2s;
            }
            .ai-settings-panel input:focus,
            .ai-settings-panel select:focus {
                border-color: hsl(142, 60%, 50%);
            }
            .ai-settings-panel input[type="password"] {
                font-family: 'JetBrains Mono', monospace;
                letter-spacing: 1px;
            }
            .ai-settings-save {
                width: 100%;
                padding: 8px;
                border-radius: 8px;
                border: none;
                background: hsl(142, 60%, 45%);
                color: white;
                font-size: 0.8rem;
                font-weight: 600;
                cursor: pointer;
                font-family: inherit;
                transition: background 0.2s;
            }
            .ai-settings-save:hover { background: hsl(142, 60%, 50%); }
            .ai-settings-info {
                font-size: 0.68rem;
                color: hsl(215, 12%, 42%);
                margin-top: 8px;
                text-align: center;
                direction: rtl;
            }
            .ai-settings-clear {
                background: transparent;
                border: 1px solid hsla(0, 72%, 55%, 0.3);
                color: hsl(0, 72%, 55%);
                padding: 6px;
                border-radius: 8px;
                font-size: 0.72rem;
                cursor: pointer;
                font-family: inherit;
                width: 100%;
                margin-top: 6px;
                transition: all 0.2s;
            }
            .ai-settings-clear:hover { background: hsla(0, 72%, 55%, 0.1); }

            .ai-chat-messages {
                flex: 1;
                overflow-y: auto;
                padding: 16px;
                display: flex;
                flex-direction: column;
                gap: 12px;
                max-height: 380px;
                scrollbar-width: thin;
                scrollbar-color: hsl(220, 16%, 20%) transparent;
            }
            .ai-chat-messages::-webkit-scrollbar { width: 4px; }
            .ai-chat-messages::-webkit-scrollbar-track { background: transparent; }
            .ai-chat-messages::-webkit-scrollbar-thumb { background: hsl(220, 16%, 25%); border-radius: 4px; }

            .ai-msg {
                max-width: 85%;
                padding: 10px 14px;
                border-radius: 12px;
                font-size: 0.85rem;
                line-height: 1.55;
                animation: ai-msg-in 0.3s ease both;
            }
            @keyframes ai-msg-in {
                from { opacity: 0; transform: translateY(8px); }
                to { opacity: 1; transform: translateY(0); }
            }
            .ai-msg.user {
                align-self: flex-end;
                background: hsl(142, 60%, 45%);
                color: white;
                border-bottom-left-radius: 12px;
                border-bottom-right-radius: 4px;
            }
            .ai-msg.assistant {
                align-self: flex-start;
                background: hsl(220, 16%, 15%);
                color: hsl(210, 20%, 88%);
                border: 1px solid hsl(220, 14%, 20%);
                border-bottom-right-radius: 12px;
                border-bottom-left-radius: 4px;
            }
            .ai-msg.assistant strong { color: hsl(142, 60%, 55%); }

            .ai-typing {
                display: flex;
                gap: 4px;
                padding: 12px 16px;
                align-self: flex-start;
            }
            .ai-typing span {
                width: 6px;
                height: 6px;
                border-radius: 50%;
                background: hsl(215, 12%, 40%);
                animation: ai-typing-dot 1.2s infinite;
            }
            .ai-typing span:nth-child(2) { animation-delay: 0.2s; }
            .ai-typing span:nth-child(3) { animation-delay: 0.4s; }
            @keyframes ai-typing-dot {
                0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
                30% { opacity: 1; transform: translateY(-4px); }
            }

            .ai-quick-actions {
                display: flex;
                flex-wrap: wrap;
                gap: 6px;
                padding: 0 16px 8px;
            }
            .ai-quick-btn {
                padding: 6px 12px;
                border-radius: 20px;
                border: 1px solid hsl(220, 14%, 20%);
                background: hsl(220, 16%, 12%);
                color: hsl(210, 20%, 75%);
                font-size: 0.75rem;
                cursor: pointer;
                transition: all 0.2s ease;
                font-family: inherit;
                white-space: nowrap;
            }
            .ai-quick-btn:hover {
                border-color: hsl(142, 60%, 50%);
                color: hsl(142, 60%, 55%);
                background: hsla(142, 60%, 50%, 0.08);
            }

            .ai-chat-input-area {
                display: flex;
                gap: 8px;
                padding: 12px 16px;
                border-top: 1px solid hsl(220, 14%, 16%);
                background: hsl(220, 16%, 9%);
            }
            .ai-chat-input {
                flex: 1;
                background: hsl(220, 16%, 13%);
                border: 1px solid hsl(220, 14%, 20%);
                border-radius: 10px;
                padding: 10px 14px;
                color: hsl(210, 20%, 92%);
                font-size: 0.85rem;
                font-family: inherit;
                outline: none;
                transition: border-color 0.2s;
                direction: rtl;
            }
            .ai-chat-input:focus {
                border-color: hsl(142, 60%, 50%);
            }
            .ai-chat-input::placeholder {
                color: hsl(215, 12%, 40%);
            }
            .ai-chat-send {
                width: 40px;
                height: 40px;
                border-radius: 10px;
                background: hsl(142, 60%, 45%);
                border: none;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                transition: all 0.2s;
                flex-shrink: 0;
            }
            .ai-chat-send:hover { background: hsl(142, 60%, 50%); }
            .ai-chat-send:disabled { opacity: 0.4; cursor: not-allowed; }

            @media (max-width: 480px) {
                .ai-chat-panel {
                    left: 8px;
                    right: 8px;
                    bottom: 80px;
                    width: auto;
                    max-height: 70vh;
                }
                .ai-fab {
                    bottom: 16px;
                    left: 16px;
                    width: 50px;
                    height: 50px;
                }
            }
        `;
        document.head.appendChild(style);
    }

    // ---- DOM Creation ----
    _createDOM() {
        // FAB Button
        this.fab = document.createElement('button');
        this.fab.className = 'ai-fab';
        this.fab.setAttribute('aria-label', 'פתח עוזר AI פיננסי');
        this.fab.innerHTML = `
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                <path d="M12 7v2m0 4h.01" opacity="0.6"/>
            </svg>
            <span class="ai-fab-badge"></span>
        `;

        // Chat Panel
        this.panel = document.createElement('div');
        this.panel.className = 'ai-chat-panel';
        this.panel.setAttribute('role', 'dialog');
        this.panel.setAttribute('aria-label', 'עוזר פיננסי AI');
        const hasKey = !!this.apiKey;
        const statusClass = hasKey ? 'connected' : 'local';
        const statusText = hasKey ? 'Claude API מחובר' : 'מצב מקומי';
        const maskedKey = hasKey ? this.apiKey.slice(0, 10) + '...' + this.apiKey.slice(-4) : '';

        this.panel.innerHTML = `
            <div class="ai-chat-header">
                <div class="ai-chat-header-title">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="3"/>
                        <path d="M12 1v4m0 14v4M4.22 4.22l2.83 2.83m9.9 9.9l2.83 2.83M1 12h4m14 0h4M4.22 19.78l2.83-2.83m9.9-9.9l2.83-2.83"/>
                    </svg>
                    עוזר פיננסי AI
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <div class="ai-chat-status ${statusClass}">${statusText}</div>
                    <button class="ai-settings-btn" id="aiSettingsToggle" aria-label="הגדרות API">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="3"/><path d="M12 1v4m0 14v4M4.22 4.22l2.83 2.83m9.9 9.9l2.83 2.83M1 12h4m14 0h4M4.22 19.78l2.83-2.83m9.9-9.9l2.83-2.83"/>
                        </svg>
                    </button>
                </div>
            </div>
            <div class="ai-settings-panel" id="aiSettingsPanel">
                <label for="aiApiKeyInput">Claude API Key</label>
                <input type="password" id="aiApiKeyInput" placeholder="sk-ant-api03-..." value="${maskedKey}" autocomplete="off">
                <label for="aiModelSelect">מודל</label>
                <select id="aiModelSelect">
                    <option value="claude-sonnet-4-5" ${this.model === 'claude-sonnet-4-5' ? 'selected' : ''}>Claude Sonnet 4.5 (מהיר, מומלץ)</option>
                    <option value="claude-haiku-4-5" ${this.model === 'claude-haiku-4-5' ? 'selected' : ''}>Claude Haiku 4.5 (מהיר מאוד, זול)</option>
                    <option value="claude-opus-4-5" ${this.model === 'claude-opus-4-5' ? 'selected' : ''}>Claude Opus 4.5 (חכם ביותר, יקר)</option>
                </select>
                <button class="ai-settings-save" id="aiSettingsSave">שמור הגדרות</button>
                <button class="ai-settings-clear" id="aiSettingsClear">מחק API Key</button>
                <div class="ai-settings-info">
                    המפתח נשמר מקומית בדפדפן בלבד (localStorage).<br>
                    ללא מפתח, העוזר עובד במצב מקומי עם ניתוח בסיסי.
                </div>
            </div>
            <div class="ai-chat-messages" id="aiChatMessages">
                <div class="ai-msg assistant">
                    שלום! אני העוזר הפיננסי שלך. ${hasKey ? 'מחובר ל-Claude API - אפשר לשאול שאלות מורכבות!' : 'עובד במצב מקומי. להגדרת Claude API לחץ על גלגל השיניים למעלה.'}
                </div>
            </div>
            <div class="ai-quick-actions" id="aiQuickActions">
                <button class="ai-quick-btn" data-q="סכם לי את החודש">סיכום חודשי</button>
                <button class="ai-quick-btn" data-q="איפה אני יכול לחסוך?">טיפים לחיסכון</button>
                <button class="ai-quick-btn" data-q="מה מצב התקציב שלי?">מצב תקציב</button>
                <button class="ai-quick-btn" data-q="נתח לי את ההוצאות">ניתוח הוצאות</button>
            </div>
            <div class="ai-chat-input-area">
                <input class="ai-chat-input" id="aiChatInput" type="text" placeholder="שאל שאלה על הכספים שלך..." autocomplete="off">
                <button class="ai-chat-send" id="aiChatSend" aria-label="שלח">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="22" y1="2" x2="11" y2="13"/>
                        <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                    </svg>
                </button>
            </div>
        `;

        document.body.appendChild(this.fab);
        document.body.appendChild(this.panel);

        this.messagesContainer = this.panel.querySelector('#aiChatMessages');
        this.input = this.panel.querySelector('#aiChatInput');
        this.sendBtn = this.panel.querySelector('#aiChatSend');
        this.statusEl = this.panel.querySelector('.ai-chat-status');
        this.settingsPanel = this.panel.querySelector('#aiSettingsPanel');
    }

    // ---- Event Binding ----
    _bindEvents() {
        this.fab.addEventListener('click', () => this.toggle());

        this.sendBtn.addEventListener('click', () => this._handleSend());
        this.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this._handleSend();
            }
        });

        // Settings panel toggle
        const settingsToggle = this.panel.querySelector('#aiSettingsToggle');
        if (settingsToggle) {
            settingsToggle.addEventListener('click', () => {
                this.settingsOpen = !this.settingsOpen;
                this.settingsPanel.classList.toggle('open', this.settingsOpen);
            });
        }

        // Save settings
        const saveBtn = this.panel.querySelector('#aiSettingsSave');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this._saveSettings());
        }

        // Clear API key
        const clearBtn = this.panel.querySelector('#aiSettingsClear');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this._clearApiKey());
        }

        // Quick action buttons
        this.panel.querySelectorAll('.ai-quick-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const q = btn.dataset.q;
                this.input.value = q;
                this._handleSend();
            });
        });

        // Close on Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) this.toggle();
        });
    }

    toggle() {
        this.isOpen = !this.isOpen;
        this.panel.classList.toggle('open', this.isOpen);
        this.fab.classList.toggle('active', this.isOpen);
        if (this.isOpen) {
            this.input.focus();
            // Hide badge
            const badge = this.fab.querySelector('.ai-fab-badge');
            if (badge) badge.style.display = 'none';
        }
    }

    async _handleSend() {
        const text = this.input.value.trim();
        if (!text || this.isTyping) return;

        this._addMessage('user', text);
        this.input.value = '';
        this.isTyping = true;
        this.sendBtn.disabled = true;
        this.statusEl.textContent = 'חושב...';

        // Show typing indicator
        const typingEl = document.createElement('div');
        typingEl.className = 'ai-typing';
        typingEl.innerHTML = '<span></span><span></span><span></span>';
        this.messagesContainer.appendChild(typingEl);
        this._scrollToBottom();

        try {
            let response;
            if (this.apiKey) {
                response = await this._callClaudeAPI(text);
            } else {
                response = await this._localAnalysis(text);
            }
            typingEl.remove();
            this._addMessage('assistant', response);
        } catch (err) {
            typingEl.remove();
            this._addMessage('assistant', 'מצטער, אירעה שגיאה. נסה שוב.');
            console.error('AI Assistant error:', err);
        }

        this.isTyping = false;
        this.sendBtn.disabled = false;
        this.statusEl.textContent = 'מוכן';
    }

    _addMessage(role, content) {
        const div = document.createElement('div');
        div.className = `ai-msg ${role}`;
        div.innerHTML = this._formatResponse(content);
        this.messagesContainer.appendChild(div);
        this.messages.push({ role, content });
        this._scrollToBottom();
    }

    _formatResponse(text) {
        // Bold text between ** **
        text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        // Line breaks
        text = text.replace(/\n/g, '<br>');
        return text;
    }

    _scrollToBottom() {
        requestAnimationFrame(() => {
            this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
        });
    }

    // ---- Analytics helpers (compute performance before sending to Claude) ----

    _toILS(amount, currency, rates) {
        if (!amount) return 0;
        if (currency === 'ILS' || !currency) return amount;
        const rate = (rates && rates[currency]) || 1;
        return amount * rate;
    }

    /**
     * Build a concise, number-heavy analytics summary of the portfolio so
     * Claude doesn't have to re-derive everything from raw JSON. Includes:
     * - Totals in ILS (stocks, bonds, cash, invested, gain/loss)
     * - Per-holding P/L (absolute + %) in both native and ILS
     * - Per-bond P/L
     * - Allocation groups: current % vs target %, diff
     * - TWR from the cached computation saved by portfolio.html
     */
    _buildPortfolioAnalytics(p) {
        if (!p) return '';
        const rates = p.rates || {};
        const holdings = Array.isArray(p.holdings) ? p.holdings : [];
        const bonds = Array.isArray(p.bonds) ? p.bonds : [];

        // Totals
        let stocksValueILS = 0, stocksCostILS = 0;
        const holdingRows = holdings.map(h => {
            const shares = Number(h.shares) || 0;
            const price  = Number(h.currentPrice) || 0;
            const cost   = Number(h.costBasis) || 0;
            const cur    = h.currency || 'ILS';
            const valueNative = shares * price;
            const costNative  = shares * cost;
            const plNative    = valueNative - costNative;
            const plPct       = costNative > 0 ? (plNative / costNative) * 100 : 0;
            const valueILS    = this._toILS(valueNative, cur, rates);
            const costILS     = this._toILS(costNative, cur, rates);
            stocksValueILS += valueILS;
            stocksCostILS  += costILS;
            return {
                symbol: h.symbol,
                currency: cur,
                shares,
                costBasis: cost,
                currentPrice: price,
                valueNative: +valueNative.toFixed(2),
                plNative: +plNative.toFixed(2),
                plPct: +plPct.toFixed(2),
                valueILS: Math.round(valueILS),
                plILS: Math.round(valueILS - costILS),
                assetGroupId: h.assetGroupId
            };
        });

        let bondsValueILS = 0, bondsCostILS = 0;
        const bondRows = bonds.map(b => {
            const units = Number(b.units) || 0;
            const price = Number(b.currentPrice) || 0;
            const cost  = Number(b.costBasis) || 0;
            const cur   = b.currency || 'ILS';
            const valueNative = units * price;
            const costNative  = units * cost;
            const plPct = costNative > 0 ? ((valueNative - costNative) / costNative) * 100 : 0;
            bondsValueILS += this._toILS(valueNative, cur, rates);
            bondsCostILS  += this._toILS(costNative, cur, rates);
            return {
                symbol: b.symbol,
                currency: cur,
                units,
                costBasis: cost,
                currentPrice: price,
                valueNative: +valueNative.toFixed(2),
                plPct: +plPct.toFixed(2),
                assetGroupId: b.assetGroupId
            };
        });

        // Cash (all three currencies → ILS)
        const cashILS = this._toILS(p.cash?.ILS || 0, 'ILS', rates)
                      + this._toILS(p.cash?.USD || 0, 'USD', rates)
                      + this._toILS(p.cash?.EUR || 0, 'EUR', rates);

        const investedValueILS = stocksValueILS + bondsValueILS;
        const investedCostILS  = stocksCostILS  + bondsCostILS;
        const totalValueILS    = investedValueILS + cashILS;
        const totalPL          = investedValueILS - investedCostILS;
        const totalPLPct       = investedCostILS > 0 ? (totalPL / investedCostILS) * 100 : 0;

        // Allocation groups: match holdings + bonds by assetGroupId, compare to target
        const groups = Array.isArray(p.groups) ? p.groups : [];
        const allocationSummary = groups.map(g => {
            let valueILS = 0;
            holdings.forEach(h => {
                if (h.assetGroupId === g.id) {
                    valueILS += this._toILS((h.shares || 0) * (h.currentPrice || 0), h.currency || 'ILS', rates);
                }
            });
            bonds.forEach(b => {
                if (b.assetGroupId === g.id) {
                    valueILS += this._toILS((b.units || 0) * (b.currentPrice || 0), b.currency || 'ILS', rates);
                }
            });
            const currentPct = investedValueILS > 0 ? (valueILS / investedValueILS) * 100 : 0;
            return {
                group: g.name,
                targetPct: g.target,
                currentPct: +currentPct.toFixed(2),
                diffPct: +(currentPct - g.target).toFixed(2),
                valueILS: Math.round(valueILS)
            };
        });

        // TWR — read from the cache portfolio.html writes on every overview render
        let twrInfo = null;
        try {
            const raw = localStorage.getItem('portfolio_cachedTWR');
            if (raw) {
                const cached = JSON.parse(raw);
                if (typeof cached.total === 'number') {
                    const ageMin = Math.round((Date.now() - (cached.timestamp || 0)) / 60000);
                    twrInfo = { totalPct: +cached.total.toFixed(2), ageMinutes: ageMin };
                }
            }
        } catch (e) {}

        // Benchmark TWR — portfolio.html caches these when the user opens
        // the performance tab. Lets the AI compare portfolio vs ACWI/SPY/etc.
        let benchmarksInfo = null;
        try {
            const raw = localStorage.getItem('portfolio_cachedBenchmarks');
            if (raw) {
                const cached = JSON.parse(raw);
                if (cached && cached.indices) {
                    const ageMin = Math.round((Date.now() - (cached.timestamp || 0)) / 60000);
                    benchmarksInfo = {
                        ageMinutes: ageMin,
                        portfolioReturn: cached.portfolioReturn,
                        portfolioMWR: cached.portfolioMWR ?? null,
                        comparisonNote: cached.comparisonNote || '',
                        dataSource: cached.dataSource || '',
                        indices: cached.indices
                    };
                }
            }
        } catch (e) {}

        return `
=== ANALYTICS מחושב (סיכום ביצועים) ===
סה"כ שווי תיק (כולל מזומן): ₪${Math.round(totalValueILS).toLocaleString()}
שווי מושקע (מניות+אג"ח): ₪${Math.round(investedValueILS).toLocaleString()}  | עלות: ₪${Math.round(investedCostILS).toLocaleString()}
רווח/הפסד כולל: ₪${Math.round(totalPL).toLocaleString()} (${totalPLPct.toFixed(2)}%)
מניות: ₪${Math.round(stocksValueILS).toLocaleString()} (עלות ₪${Math.round(stocksCostILS).toLocaleString()})
אג"ח: ₪${Math.round(bondsValueILS).toLocaleString()} (עלות ₪${Math.round(bondsCostILS).toLocaleString()})
מזומן: ₪${Math.round(cashILS).toLocaleString()} (ILS=${p.cash?.ILS||0}, USD=${p.cash?.USD||0}, EUR=${p.cash?.EUR||0})
TWR: ${twrInfo ? `${twrInfo.totalPct}% (מ-cache לפני ${twrInfo.ageMinutes} דק')` : '—  (טרם חושב; המשתמש צריך לפתוח את טאב סיכום)'}

-- ביצועים לפי אחזקה (per-holding P/L) --
${holdingRows.map(r => `${r.symbol}: ${r.shares} יח' × ${r.currentPrice} ${r.currency} = ${r.valueNative} ${r.currency} (₪${r.valueILS.toLocaleString()}) | P/L: ${r.plNative} ${r.currency} (${r.plPct}%)`).join('\n') || '—'}

-- ביצועים לפי אג"ח --
${bondRows.map(r => `${r.symbol}: ${r.units} יח' × ${r.currentPrice} ${r.currency} | P/L: ${r.plPct}%`).join('\n') || '—'}

-- הקצאה מול יעד (allocation vs target) --
${allocationSummary.map(a => `${a.group}: נוכחי ${a.currentPct}% vs יעד ${a.targetPct}% (סטייה ${a.diffPct > 0 ? '+' : ''}${a.diffPct}%) — ₪${a.valueILS.toLocaleString()}`).join('\n') || '—'}

-- השוואה למדדי ייחוס --
${benchmarksInfo
    ? `[TWR — איכות ההרכב, מנוטרל מתזמון הפקדות]
תיק: ${benchmarksInfo.portfolioReturn}%
${Object.entries(benchmarksInfo.indices).map(([k, v]) => `${v.label} (${k}): ${v.returnPct}%`).join('\n')}

[MWR — תשואה אמיתית של הכסף, אנואלי, כולל תזמון הפקדות]
${benchmarksInfo.portfolioMWR !== null ? `תיק: ${benchmarksInfo.portfolioMWR}%/שנה` : 'תיק: —'}
${Object.entries(benchmarksInfo.indices).map(([k, v]) => `${v.label} (${k}): ${v.mwrAnnualPct !== null && v.mwrAnnualPct !== undefined ? v.mwrAnnualPct + '%/שנה' : '—'}`).join('\n')}

⚠️ הבחנה חשובה: TWR מודד אסטרטגיה אבסטרקטית; MWR מודד את הכסף האמיתי. הפער בין שניהם בתיק נובע ממתי בפועל נכנסו ההפקדות. כשמשווים מציאות-למציאות (MWR) הפער בד"כ קטן בהרבה.${benchmarksInfo.comparisonNote ? `\nהערה: ${benchmarksInfo.comparisonNote}` : ''}${benchmarksInfo.dataSource ? `\nמקור: ${benchmarksInfo.dataSource}` : ''}
(מ-cache לפני ${benchmarksInfo.ageMinutes} דק')`
    : '— (טרם חושב; המשתמש צריך לפתוח את טאב ביצועים)'}
=== סוף ANALYTICS ===`;
    }

    // ---- Claude API Integration ----
    async _callClaudeAPI(userMessage) {
        const financeData = this.getFinanceData();
        const portfolioData = this.getPortfolioData();

        const hasFinance = (financeData.transactions && financeData.transactions.length > 0) ||
                           (financeData.fixedIncomes && financeData.fixedIncomes.length > 0);
        const hasPortfolio = (portfolioData.holdings && portfolioData.holdings.length > 0) ||
                             (portfolioData.bonds && portfolioData.bonds.length > 0);

        let dataSection = '';

        if (hasFinance) {
            dataSection += `
=== נתוני מעקב כספי ===
עסקאות אחרונות (עד 50): ${JSON.stringify((financeData.transactions || []).slice(-50))}
תקציבים: ${JSON.stringify(financeData.budgets || {})}
קטגוריות הכנסה: ${JSON.stringify(financeData.incomeCategories || [])}
קטגוריות הוצאה: ${JSON.stringify(financeData.expenseCategories || [])}
הכנסות קבועות: ${JSON.stringify(financeData.fixedIncomes || [])}
הוצאות קבועות: ${JSON.stringify(financeData.fixedExpenses || [])}
=== סוף נתוני מעקב כספי ===`;
        }

        if (hasPortfolio) {
            // The computed analytics section gives Claude the answers it
            // would otherwise have to derive from raw JSON (P/L, TWR,
            // allocation vs target). Cheap to compute here, saves the
            // model from doing arithmetic on dozens of rows.
            dataSection += this._buildPortfolioAnalytics(portfolioData);
            dataSection += `
=== נתוני תיק השקעות (גלם) ===
אחזקות מניות: ${JSON.stringify(portfolioData.holdings || [])}
אגרות חוב: ${JSON.stringify(portfolioData.bonds || [])}
מזומן בתיק: ${JSON.stringify(portfolioData.cash || {})}
שערי מט"ח: ${JSON.stringify(portfolioData.rates || {})}
קבוצות הקצאה (groups): ${JSON.stringify(portfolioData.groups || [])}
פקדונות: ${JSON.stringify(portfolioData.deposits || [])}
רכישות אחרונות (עד 20): ${JSON.stringify((portfolioData.purchases || []).slice(-20))}
מכירות אחרונות (עד 20): ${JSON.stringify((portfolioData.sales || []).slice(-20))}
תמונות מצב (snapshots): ${JSON.stringify((portfolioData.portfolioSnapshots || portfolioData.snapshots || []).slice(-12))}
רשימת מעקב (watchlist): ${JSON.stringify(portfolioData.watchlist || [])}
דיבידנדים: ${JSON.stringify((portfolioData.dividends || []).slice(-20))}
=== סוף נתוני השקעות ===`;
        }

        if (!hasFinance && !hasPortfolio) {
            dataSection = `
=== אין נתונים ===
לא נמצאו נתונים בדף הנוכחי. ייתכן שהנתונים טרם נטענו או שהמשתמש בדף שלא מכיל נתונים.
=== סוף ===`;
        }

        const systemPrompt = `אתה עוזר פיננסי אישי חכם המשולב באפליקציית ניהול פיננסי ותיק השקעות.
יש לך גישה מלאה לנתונים של המשתמש — הם מועברים אליך ישירות מהאפליקציה.

חשוב: הנתונים למטה הם הנתונים האמיתיים של המשתמש. אל תגיד שאין לך גישה — הנתונים כבר מולך! נתח אותם ותן תשובות מבוססות נתונים.

**העדף את סקשן ה-ANALYTICS המחושב** על פני חישוב מחדש מ-JSON הגלם: שם כבר יש לך TWR, P/L לכל אחזקה, הקצאה מול יעד, ותרגומי מטבע. השתמש ב-JSON הגלם רק כשצריך פרט ספציפי שלא מופיע ב-ANALYTICS.

${dataSection}

הנחיות:
- תגיב בעברית, בצורה קצרה וברורה
- השתמש במספרים מדויקים מהנתונים למעלה (מעדיף את סקשן ANALYTICS)
- הצע פעולות קונקרטיות לשיפור המצב הפיננסי
- אם יש נתוני השקעות, נתח ביצועים, הקצאה, וחשיפה למט"ח
- אם שדה מסוים ריק, ציין זאת למשתמש והמלץ להוסיף נתונים
- אם TWR מראה '—' — ציין למשתמש שעליו לפתוח את טאב "סיכום" פעם אחת כדי שה-TWR יחושב וייקושש`;

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({
                model: this.model,
                max_tokens: 1500,
                system: systemPrompt,
                messages: [
                    ...this.messages.slice(-10).map(m => ({
                        role: m.role,
                        content: m.content
                    })),
                    { role: 'user', content: userMessage }
                ]
            })
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            throw new Error(`API Error ${response.status}: ${errText.slice(0, 200)}`);
        }

        const data = await response.json();
        return data.content[0].text;
    }

    // ---- Local Analysis (No API Key) ----
    // Helper: get full monthly summary including fixed incomes/expenses
    _getMonthSummary(month) {
        const data = this.getFinanceData();
        const transactions = data.transactions || [];
        const fixedIncomes = data.fixedIncomes || [];
        const fixedExpenses = data.fixedExpenses || [];

        const monthTx = transactions.filter(t => t.month === month && t.type !== 'manual-tithe');
        let inc = monthTx.filter(t => t.type === 'income').reduce((s, t) => s + (t.amt || 0), 0);
        let exp = monthTx.filter(t => t.type === 'expense').reduce((s, t) => s + (t.amt || 0), 0);

        // Add fixed incomes/expenses for this month
        fixedIncomes.forEach(f => {
            if (this._monthInRange(month, f.start, f.end)) inc += f.amount;
        });
        fixedExpenses.forEach(f => {
            if (this._monthInRange(month, f.start, f.end)) exp += f.amount;
        });

        const bal = inc - exp;
        return { inc, exp, bal, transactions: monthTx };
    }

    _monthInRange(month, start, end) {
        if (!start || !end) return false;
        return month >= start && month <= end;
    }

    _getMonthExpensesByCategory(month) {
        const data = this.getFinanceData();
        const transactions = data.transactions || [];
        const fixedExpenses = data.fixedExpenses || [];
        const cats = {};

        transactions.filter(t => t.month === month && t.type === 'expense').forEach(t => {
            cats[t.cat || 'אחר'] = (cats[t.cat || 'אחר'] || 0) + (t.amt || 0);
        });
        fixedExpenses.forEach(f => {
            if (this._monthInRange(month, f.start, f.end)) {
                cats[f.category || 'אחר'] = (cats[f.category || 'אחר'] || 0) + f.amount;
            }
        });
        return cats;
    }

    _getMonthIncomesByCategory(month) {
        const data = this.getFinanceData();
        const transactions = data.transactions || [];
        const fixedIncomes = data.fixedIncomes || [];
        const cats = {};

        transactions.filter(t => t.month === month && t.type === 'income').forEach(t => {
            cats[t.cat || 'אחר'] = (cats[t.cat || 'אחר'] || 0) + (t.amt || 0);
        });
        fixedIncomes.forEach(f => {
            if (this._monthInRange(month, f.start, f.end)) {
                cats[f.category || 'אחר'] = (cats[f.category || 'אחר'] || 0) + f.amount;
            }
        });
        return cats;
    }

    // Get portfolio summary for chat
    _getPortfolioSummary() {
        const p = this.getPortfolioData();
        if (!p || !p.holdings || p.holdings.length === 0) return null;

        const holdings = p.holdings || [];
        const bonds = p.bonds || [];
        const rates = p.rates || { USD: 3.6, EUR: 3.9 };
        const toILS = (val, cur) => cur === 'USD' ? val * rates.USD : cur === 'EUR' ? val * rates.EUR : val;

        let stocksValue = 0, stocksCost = 0;
        const topHoldings = [];
        holdings.forEach(h => {
            const val = toILS(h.shares * (h.currentPrice || h.costBasis), h.currency);
            const cost = toILS(h.shares * h.costBasis, h.currency);
            stocksValue += val;
            stocksCost += cost;
            topHoldings.push({ symbol: h.symbol, value: val, cost: cost, pl: val - cost, plPct: cost > 0 ? ((val-cost)/cost*100) : 0 });
        });
        topHoldings.sort((a,b) => b.value - a.value);

        let bondsValue = 0, bondsCost = 0;
        bonds.forEach(b => {
            bondsValue += b.units * (b.currentPrice || b.costBasis);
            bondsCost += b.units * b.costBasis;
        });

        const cash = (p.cash?.ILS || 0) + toILS(p.cash?.USD || 0, 'USD') + toILS(p.cash?.EUR || 0, 'EUR');
        const total = stocksValue + bondsValue + cash;
        const totalCost = stocksCost + bondsCost;

        return { stocksValue, stocksCost, bondsValue, bondsCost, cash, total, totalCost, topHoldings, holdings, bonds, groups: p.groups || [] };
    }

    async _localAnalysis(query) {
        await new Promise(r => setTimeout(r, 300 + Math.random() * 300));

        const data = this.getFinanceData();
        const budgets = data.budgets || {};
        const q = query.toLowerCase();
        const portfolio = this._getPortfolioSummary();

        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1);
        const prevMonth = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}`;

        const current = this._getMonthSummary(currentMonth);
        const prev = this._getMonthSummary(prevMonth);
        const fmt = (n) => `₪${Math.round(n).toLocaleString()}`;
        const monthName = now.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });

        // ============ PORTFOLIO QUERIES ============
        if (q.includes('תיק') || q.includes('השקעות') || q.includes('מניות') || q.includes('portfolio') || q.includes('אג"ח') || q.includes('אגח')) {
            if (!portfolio) {
                return '**אין נתוני תיק השקעות**\n\nלא נמצאו נתונים על תיק השקעות. עבור לדף תיק ההשקעות והוסף אחזקות.';
            }

            const pl = portfolio.total - portfolio.totalCost;
            const plPct = portfolio.totalCost > 0 ? ((pl / portfolio.totalCost) * 100).toFixed(1) : 0;

            let text = `**תיק ההשקעות:**\n\n`;
            text += `שווי כולל: **${fmt(portfolio.total)}**\n`;
            text += `רווח/הפסד: **${pl >= 0 ? '+' : ''}${fmt(pl)}** (${pl >= 0 ? '+' : ''}${plPct}%)\n\n`;

            if (portfolio.stocksValue > 0) {
                const sPL = portfolio.stocksValue - portfolio.stocksCost;
                text += `**מניות**: ${fmt(portfolio.stocksValue)} (${sPL >= 0 ? '+' : ''}${fmt(sPL)})\n`;
            }
            if (portfolio.bondsValue > 0) {
                const bPL = portfolio.bondsValue - portfolio.bondsCost;
                text += `**אג"ח**: ${fmt(portfolio.bondsValue)} (${bPL >= 0 ? '+' : ''}${fmt(bPL)})\n`;
            }
            if (portfolio.cash > 0) {
                text += `**מזומן**: ${fmt(portfolio.cash)}\n`;
            }

            // Top/Bottom holdings
            if (portfolio.topHoldings.length > 0) {
                text += '\n**אחזקות מובילות:**\n';
                portfolio.topHoldings.slice(0, 5).forEach(h => {
                    text += `• ${h.symbol}: ${fmt(h.value)} (${h.plPct >= 0 ? '+' : ''}${h.plPct.toFixed(1)}%)\n`;
                });

                // Best and worst performers
                const sorted = [...portfolio.topHoldings].sort((a,b) => b.plPct - a.plPct);
                const best = sorted[0];
                const worst = sorted[sorted.length - 1];
                if (sorted.length >= 2) {
                    text += `\n**הכי רווחי**: ${best.symbol} (${best.plPct >= 0 ? '+' : ''}${best.plPct.toFixed(1)}%)`;
                    text += `\n**הכי הפסדי**: ${worst.symbol} (${worst.plPct >= 0 ? '+' : ''}${worst.plPct.toFixed(1)}%)`;
                }
            }

            return text;
        }

        // ============ SAVINGS TIPS - ACTIONABLE ============
        if (q.includes('חסוך') || q.includes('חיסכון') || q.includes('טיפ') || q.includes('עצה') || q.includes('לשפר') || q.includes('recommend')) {
            const cats = this._getMonthExpensesByCategory(currentMonth);
            const prevCats = this._getMonthExpensesByCategory(prevMonth);
            const sorted = Object.entries(cats).sort((a, b) => b[1] - a[1]);

            let tips = `**טיפים לחיסכון - ${monthName}:**\n\n`;
            let tipNum = 1;

            // 1. Budget overruns - specific action
            Object.entries(budgets).forEach(([cat, budget]) => {
                const spent = cats[cat] || 0;
                if (spent > budget) {
                    const excess = spent - budget;
                    tips += `${tipNum}. **${cat}** - חריגה של ${fmt(excess)} מהתקציב.\n`;
                    tips += `   → הגבל ל-${Math.ceil(budget / 30)} ₪ ליום (${fmt(budget)} / 30 ימים)\n\n`;
                    tipNum++;
                }
            });

            // 2. Categories that increased significantly
            sorted.forEach(([cat, amt]) => {
                const prevAmt = prevCats[cat];
                if (prevAmt && amt > prevAmt * 1.2 && tipNum <= 5) {
                    const increase = amt - prevAmt;
                    const pct = Math.round(((amt - prevAmt) / prevAmt) * 100);
                    tips += `${tipNum}. **${cat}** עלה ב-${pct}% (${fmt(increase)} יותר מחודש קודם).\n`;
                    tips += `   → בדוק אם יש עסקאות חד-פעמיות שניתן לוותר עליהן\n\n`;
                    tipNum++;
                }
            });

            // 3. Large categories without budget
            sorted.forEach(([cat, amt]) => {
                if (!budgets[cat] && amt > current.exp * 0.15 && tipNum <= 6) {
                    tips += `${tipNum}. **${cat}** (${fmt(amt)}) - אין תקציב מוגדר לקטגוריה גדולה.\n`;
                    tips += `   → הגדר תקציב של ${fmt(Math.round(amt * 0.85))} (15% הורדה)\n\n`;
                    tipNum++;
                }
            });

            // 4. Fixed expenses optimization
            const fixedExp = (data.fixedExpenses || []).filter(f => this._monthInRange(currentMonth, f.start, f.end));
            const fixedTotal = fixedExp.reduce((s, f) => s + f.amount, 0);
            if (fixedTotal > current.exp * 0.4 && tipNum <= 7) {
                tips += `${tipNum}. **הוצאות קבועות** מהוות ${Math.round(fixedTotal / current.exp * 100)}% מההוצאות (${fmt(fixedTotal)}).\n`;
                tips += `   → בדוק אם ניתן לנהל מו"מ על חוזים (אינטרנט, ביטוח, טלפון)\n\n`;
                tipNum++;
            }

            // 5. Savings rate target
            if (current.inc > 0) {
                const savingsRate = Math.round((current.bal / current.inc) * 100);
                const idealSave = current.inc * 0.2;
                if (current.bal < idealSave) {
                    const needed = idealSave - current.bal;
                    tips += `${tipNum}. **יעד חיסכון**: שיעור החיסכון שלך הוא ${savingsRate}%. להגיע ל-20% חסרים **${fmt(needed)}**.\n`;
                    // Find the category with easiest cut
                    if (sorted.length > 0) {
                        const easyCut = sorted.find(([cat]) => ['בילויים', 'קניות', 'מסעדות', 'בידור'].includes(cat)) || sorted[sorted.length > 2 ? 2 : 0];
                        if (easyCut) {
                            tips += `   → נסה לקצץ ב-**${easyCut[0]}** שהוא ${fmt(easyCut[1])} החודש\n\n`;
                        }
                    }
                    tipNum++;
                } else {
                    tips += `\n✓ מצוין! שיעור חיסכון של **${savingsRate}%** - מעל יעד ה-20%!\n`;
                    if (portfolio && portfolio.total > 0) {
                        tips += `→ שקול להעביר חלק מהחיסכון לתיק ההשקעות\n`;
                    }
                }
            }

            if (tipNum === 1) {
                tips += 'לא זוהו נקודות חיסכון ברורות. המצב הפיננסי נראה טוב!';
            }

            return tips;
        }

        // ============ MONTHLY SUMMARY ============
        if (q.includes('סכם') || q.includes('סיכום') || q.includes('חודש')) {
            const savingsRate = current.inc > 0 ? ((current.bal / current.inc) * 100).toFixed(1) : 0;
            const incChange = prev.inc > 0 ? (((current.inc - prev.inc) / prev.inc) * 100).toFixed(1) : null;
            const expChange = prev.exp > 0 ? (((current.exp - prev.exp) / prev.exp) * 100).toFixed(1) : null;

            let text = `**סיכום ${monthName}**\n\n`;
            text += `הכנסות: **${fmt(current.inc)}**`;
            if (incChange !== null) text += ` (${incChange > 0 ? '+' : ''}${incChange}%)`;
            text += `\nהוצאות: **${fmt(current.exp)}**`;
            if (expChange !== null) text += ` (${expChange > 0 ? '+' : ''}${expChange}%)`;
            text += `\nיתרה: **${fmt(current.bal)}** (${savingsRate}% חיסכון)\n\n`;

            const cats = this._getMonthExpensesByCategory(currentMonth);
            const sorted = Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 3);
            if (sorted.length > 0) {
                text += '**הוצאות עיקריות:**\n';
                sorted.forEach(([cat, amt]) => { text += `• ${cat}: ${fmt(amt)}\n`; });
            }

            // Add portfolio snapshot if available
            if (portfolio && portfolio.total > 0) {
                const pl = portfolio.total - portfolio.totalCost;
                text += `\n**תיק השקעות**: ${fmt(portfolio.total)} (${pl >= 0 ? '+' : ''}${fmt(pl)})`;
            }

            if (current.bal >= 0) {
                text += `\n\n${savingsRate >= 20 ? 'מצוין!' : 'טוב.'} ${savingsRate < 20 ? 'כדאי לשאוף ל-20% חיסכון.' : ''}`;
            } else {
                text += `\n\n⚠️ ההוצאות עולות על ההכנסות ב-${fmt(Math.abs(current.bal))}`;
            }
            return text;
        }

        // ============ BUDGET STATUS ============
        if (q.includes('תקציב')) {
            const cats = this._getMonthExpensesByCategory(currentMonth);
            const budgetEntries = Object.entries(budgets);

            if (budgetEntries.length === 0) {
                return `**אין תקציבים מוגדרים**\n\nלך לטאב הגדרות כדי להגדיר תקציב לכל קטגוריה.\n\nהנה ההוצאות ב${monthName}:\n` +
                    Object.entries(cats).sort((a,b) => b[1]-a[1]).map(([c,a]) => `• ${c}: ${fmt(a)}`).join('\n');
            }

            let status = `**מצב תקציב - ${monthName}:**\n\n`;
            let overBudget = 0, totalSpent = 0, totalBudget = 0;
            budgetEntries.forEach(([cat, budget]) => {
                const spent = cats[cat] || 0;
                totalSpent += spent; totalBudget += budget;
                const pct = budget > 0 ? Math.round((spent / budget) * 100) : 0;
                const bar = pct >= 100 ? '🔴' : pct >= 80 ? '🟡' : '🟢';
                status += `${bar} **${cat}**: ${fmt(spent)} / ${fmt(budget)} (${pct}%)\n`;
                if (spent > budget) overBudget++;
            });
            const totalPct = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;
            status += `\n**סה"כ**: ${fmt(totalSpent)} / ${fmt(totalBudget)} (${totalPct}%)\n`;
            status += overBudget > 0 ? `\n⚠️ ${overBudget} קטגוריות חרגו!` : '\n✓ הכל בתקציב!';
            return status;
        }

        // ============ EXPENSE ANALYSIS ============
        if (q.includes('נתח') || q.includes('ניתוח') || q.includes('הוצאות')) {
            const cats = this._getMonthExpensesByCategory(currentMonth);
            const prevCats = this._getMonthExpensesByCategory(prevMonth);
            let analysis = `**ניתוח הוצאות - ${monthName}:**\n\n`;
            Object.entries(cats).sort((a, b) => b[1] - a[1]).forEach(([cat, amt]) => {
                const pct = current.exp > 0 ? ((amt / current.exp) * 100).toFixed(1) : 0;
                const prevAmt = prevCats[cat] || 0;
                let trend = '';
                if (prevAmt > 0) {
                    const change = Math.round(((amt - prevAmt) / prevAmt) * 100);
                    trend = change > 10 ? ` ↑${change}%` : change < -10 ? ` ↓${Math.abs(change)}%` : ' →';
                }
                analysis += `• **${cat}**: ${fmt(amt)} (${pct}%)${trend}\n`;
            });
            analysis += `\n**סה"כ**: ${fmt(current.exp)}`;
            if (prev.exp > 0) {
                const c = Math.round(((current.exp - prev.exp) / prev.exp) * 100);
                analysis += ` (${c > 0 ? '+' : ''}${c}% מחודש קודם)`;
            }
            return analysis;
        }

        // ============ INCOME ANALYSIS ============
        if (q.includes('הכנסה') || q.includes('הכנסות') || q.includes('משכורת')) {
            const incomeCats = this._getMonthIncomesByCategory(currentMonth);
            let text = `**הכנסות - ${monthName}**\n\nסה"כ: **${fmt(current.inc)}**\n`;
            if (prev.inc > 0) {
                const c = Math.round(((current.inc - prev.inc) / prev.inc) * 100);
                text += `שינוי: ${c > 0 ? '+' : ''}${c}%\n`;
            }
            text += '\n';
            Object.entries(incomeCats).sort((a,b) => b[1]-a[1]).forEach(([cat, amt]) => {
                text += `• ${cat}: ${fmt(amt)}\n`;
            });
            return text;
        }

        // ============ COMPARISON ============
        if (q.includes('השוואה') || q.includes('השווה') || q.includes('לעומת')) {
            let text = `**השוואה: ${monthName} לעומת חודש קודם**\n\n`;
            const ic = prev.inc > 0 ? Math.round(((current.inc - prev.inc) / prev.inc) * 100) : 0;
            const ec = prev.exp > 0 ? Math.round(((current.exp - prev.exp) / prev.exp) * 100) : 0;
            text += `הכנסות: **${fmt(current.inc)}** ← ${fmt(prev.inc)} (${ic > 0 ? '+' : ''}${ic}%)\n`;
            text += `הוצאות: **${fmt(current.exp)}** ← ${fmt(prev.exp)} (${ec > 0 ? '+' : ''}${ec}%)\n`;
            text += `יתרה: **${fmt(current.bal)}** ← ${fmt(prev.bal)}\n`;
            return text;
        }

        // ============ FIXED EXPENSES ============
        if (q.includes('קבוע') || q.includes('קבועות') || q.includes('קבועים')) {
            const fixedInc = (data.fixedIncomes || []).filter(f => this._monthInRange(currentMonth, f.start, f.end));
            const fixedExp = (data.fixedExpenses || []).filter(f => this._monthInRange(currentMonth, f.start, f.end));
            let text = `**הוצאות והכנסות קבועות - ${monthName}:**\n\n`;
            if (fixedInc.length > 0) {
                text += '**הכנסות קבועות:**\n';
                fixedInc.forEach(f => { text += `• ${f.description}: ${fmt(f.amount)} (${f.category})\n`; });
                text += '\n';
            }
            if (fixedExp.length > 0) {
                text += '**הוצאות קבועות:**\n';
                fixedExp.forEach(f => { text += `• ${f.description}: ${fmt(f.amount)} (${f.category})\n`; });
            }
            if (fixedInc.length === 0 && fixedExp.length === 0) text += 'לא הוגדרו הוצאות/הכנסות קבועות.';
            return text;
        }

        // ============ SMART CATCH-ALL: Try to understand the question ============
        const hasFinanceData = current.inc > 0 || current.exp > 0;
        const hasPortfolioData = portfolio && portfolio.total > 0;

        // Numbers / amounts
        if (q.includes('כמה')) {
            if (q.includes('הוצאתי') || q.includes('שילמתי')) {
                // Try to find specific category
                const cats = this._getMonthExpensesByCategory(currentMonth);
                for (const [cat, amt] of Object.entries(cats)) {
                    if (q.includes(cat.toLowerCase())) {
                        return `ב${monthName} הוצאת **${fmt(amt)}** על **${cat}** (${current.exp > 0 ? ((amt/current.exp)*100).toFixed(1) : 0}% מסה"כ הוצאות).`;
                    }
                }
                return `סה"כ הוצאות ב${monthName}: **${fmt(current.exp)}**\n\n` +
                    Object.entries(cats).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([c,a]) => `• ${c}: ${fmt(a)}`).join('\n');
            }
            if (q.includes('הרווחתי') || q.includes('הכנסתי')) {
                return `סה"כ הכנסות ב${monthName}: **${fmt(current.inc)}**`;
            }
            if (q.includes('חסכתי') || q.includes('נשאר')) {
                return `יתרה ב${monthName}: **${fmt(current.bal)}** (${current.inc > 0 ? Math.round((current.bal/current.inc)*100) : 0}% חיסכון)`;
            }
            if (q.includes('שווה') && hasPortfolioData) {
                return `שווי תיק ההשקעות: **${fmt(portfolio.total)}** (רווח: ${fmt(portfolio.total - portfolio.totalCost)})`;
            }
        }

        // What/why questions
        if (q.includes('מה') || q.includes('למה') || q.includes('איך') || q.includes('איפה') || q.includes('?')) {
            if (q.includes('הכי') && (q.includes('גדולה') || q.includes('יקרה') || q.includes('הוצאה'))) {
                const cats = this._getMonthExpensesByCategory(currentMonth);
                const top = Object.entries(cats).sort((a,b) => b[1]-a[1])[0];
                if (top) return `ההוצאה הגדולה ביותר ב${monthName}: **${top[0]}** - ${fmt(top[1])} (${((top[1]/current.exp)*100).toFixed(0)}% מההוצאות)`;
            }
            if (q.includes('מצב') || q.includes('עומד')) {
                let text = `**מצב פיננסי - ${monthName}:**\n\n`;
                text += `הכנסות: ${fmt(current.inc)} | הוצאות: ${fmt(current.exp)} | יתרה: ${fmt(current.bal)}\n`;
                if (hasPortfolioData) text += `תיק השקעות: ${fmt(portfolio.total)}\n`;
                const savingsRate = current.inc > 0 ? Math.round((current.bal / current.inc) * 100) : 0;
                text += `\nשיעור חיסכון: ${savingsRate}% ${savingsRate >= 20 ? '✓' : '(יעד: 20%)'}`;
                return text;
            }
        }

        // If we still haven't matched - give useful overview
        let response = '';
        if (hasFinanceData) {
            const savingsRate = current.inc > 0 ? Math.round((current.bal / current.inc) * 100) : 0;
            response += `**${monthName}**: הכנסות ${fmt(current.inc)} | הוצאות ${fmt(current.exp)} | יתרה ${fmt(current.bal)} (${savingsRate}%)\n`;
        }
        if (hasPortfolioData) {
            const pl = portfolio.total - portfolio.totalCost;
            response += `**תיק השקעות**: ${fmt(portfolio.total)} (${pl >= 0 ? '+' : ''}${fmt(pl)})\n`;
        }

        response += '\n**אני יכול לעזור עם:**\n';
        response += '• "סכם לי את החודש"\n';
        response += '• "טיפים לחיסכון" - המלצות פרקטיות\n';
        response += '• "מצב תקציב" - עמידה ביעדים\n';
        response += '• "נתח הוצאות" - פירוט קטגוריות\n';
        response += '• "מצב תיק ההשקעות"\n';
        response += '• "כמה הוצאתי על [קטגוריה]?"\n';
        response += '• "השוואה לחודש קודם"\n';
        response += '• כל שאלה חופשית על הכספים שלך\n\n';
        response += 'לשאלות מורכבות יותר, הגדר מפתח Claude API ב-⚙️';

        return response;
    }

    // ---- Settings Management ----
    _saveSettings() {
        const keyInput = this.panel.querySelector('#aiApiKeyInput');
        const modelSelect = this.panel.querySelector('#aiModelSelect');
        const key = keyInput.value.trim();
        const model = modelSelect.value;

        // Only save if key looks new (not masked)
        if (key && !key.includes('...')) {
            if (!key.startsWith('sk-ant-')) {
                this._addMessage('assistant', 'המפתח לא נראה תקין. מפתח Claude API מתחיל ב-**sk-ant-**');
                return;
            }
            this.apiKey = key;
            localStorage.setItem('ai_api_key', key);
            keyInput.value = key.slice(0, 10) + '...' + key.slice(-4);
        }

        this.model = model;
        localStorage.setItem('ai_model', model);

        // Update status indicator
        this._updateStatus();

        // Close settings
        this.settingsOpen = false;
        this.settingsPanel.classList.remove('open');

        this._addMessage('assistant', this.apiKey
            ? `הגדרות נשמרו! מחובר ל-**${this._modelDisplayName()}**. אפשר לשאול שאלות מורכבות עכשיו.`
            : 'הגדרות נשמרו. עובד במצב מקומי (ללא API key).'
        );
    }

    _clearApiKey() {
        this.apiKey = null;
        localStorage.removeItem('ai_api_key');
        localStorage.removeItem('ai_model');
        this.model = 'claude-sonnet-4-5';

        const keyInput = this.panel.querySelector('#aiApiKeyInput');
        const modelSelect = this.panel.querySelector('#aiModelSelect');
        if (keyInput) keyInput.value = '';
        if (modelSelect) modelSelect.value = 'claude-sonnet-4-5';

        this._updateStatus();
        this.settingsOpen = false;
        this.settingsPanel.classList.remove('open');

        this._addMessage('assistant', 'API Key נמחק. העוזר עובד כעת במצב מקומי.');
    }

    _updateStatus() {
        if (!this.statusEl) return;
        if (this.apiKey) {
            this.statusEl.className = 'ai-chat-status connected';
            this.statusEl.textContent = 'Claude API מחובר';
        } else {
            this.statusEl.className = 'ai-chat-status local';
            this.statusEl.textContent = 'מצב מקומי';
        }
    }

    _modelDisplayName() {
        const names = {
            'claude-sonnet-4-5': 'Claude Sonnet 4.5',
            'claude-haiku-4-5':  'Claude Haiku 4.5',
            'claude-opus-4-5':   'Claude Opus 4.5'
        };
        return names[this.model] || this.model;
    }

    // ---- Public API ----
    setApiKey(key) {
        this.apiKey = key;
        localStorage.setItem('ai_api_key', key);
        this._updateStatus();
    }

    destroy() {
        this.fab?.remove();
        this.panel?.remove();
        document.getElementById('ai-assistant-styles')?.remove();
    }
}

// ==================== COMMAND PALETTE ====================

class CommandPalette {
    constructor(options = {}) {
        this.commands = options.commands || [];
        this.onExecute = options.onExecute || (() => {});
        this.isOpen = false;
        this.selectedIndex = 0;
        this.filteredCommands = [];

        this._injectStyles();
        this._createDOM();
        this._bindEvents();
    }

    _injectStyles() {
        if (document.getElementById('cmd-palette-styles')) return;
        const style = document.createElement('style');
        style.id = 'cmd-palette-styles';
        style.textContent = `
            .cmd-overlay {
                position: fixed;
                inset: 0;
                background: rgba(0,0,0,0.6);
                backdrop-filter: blur(4px);
                z-index: 20000;
                display: none;
                justify-content: center;
                align-items: flex-start;
                padding-top: 20vh;
            }
            .cmd-overlay.open { display: flex; }

            .cmd-dialog {
                width: 560px;
                max-width: 90vw;
                background: hsl(220, 18%, 11%);
                border: 1px solid hsl(220, 14%, 20%);
                border-radius: 14px;
                box-shadow: 0 20px 60px rgba(0,0,0,0.5);
                overflow: hidden;
                animation: cmd-in 0.2s ease;
            }
            @keyframes cmd-in {
                from { opacity: 0; transform: scale(0.96) translateY(-8px); }
                to { opacity: 1; transform: scale(1) translateY(0); }
            }

            .cmd-input-wrap {
                display: flex;
                align-items: center;
                padding: 14px 18px;
                border-bottom: 1px solid hsl(220, 14%, 16%);
                gap: 10px;
            }
            .cmd-input-wrap svg {
                width: 18px;
                height: 18px;
                color: hsl(215, 12%, 45%);
                flex-shrink: 0;
            }
            .cmd-input {
                flex: 1;
                background: transparent;
                border: none;
                color: hsl(210, 20%, 92%);
                font-size: 0.95rem;
                font-family: inherit;
                outline: none;
                direction: rtl;
            }
            .cmd-input::placeholder { color: hsl(215, 12%, 40%); }

            .cmd-shortcut-hint {
                font-size: 0.7rem;
                color: hsl(215, 12%, 40%);
                background: hsl(220, 16%, 15%);
                padding: 2px 6px;
                border-radius: 4px;
                border: 1px solid hsl(220, 14%, 22%);
            }

            .cmd-list {
                max-height: 320px;
                overflow-y: auto;
                padding: 6px;
                scrollbar-width: thin;
                scrollbar-color: hsl(220, 16%, 20%) transparent;
            }
            .cmd-item {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 10px 14px;
                border-radius: 8px;
                cursor: pointer;
                transition: background 0.15s;
                direction: rtl;
            }
            .cmd-item:hover, .cmd-item.selected {
                background: hsl(220, 16%, 16%);
            }
            .cmd-item.selected {
                border: 1px solid hsla(142, 60%, 50%, 0.2);
            }
            .cmd-item-icon {
                width: 32px;
                height: 32px;
                border-radius: 8px;
                background: hsl(220, 16%, 14%);
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 0.9rem;
                flex-shrink: 0;
            }
            .cmd-item-text { flex: 1; }
            .cmd-item-title {
                color: hsl(210, 20%, 90%);
                font-size: 0.85rem;
                font-weight: 500;
            }
            .cmd-item-desc {
                color: hsl(215, 12%, 48%);
                font-size: 0.72rem;
                margin-top: 2px;
            }
            .cmd-item-shortcut {
                font-size: 0.7rem;
                color: hsl(215, 12%, 40%);
                background: hsl(220, 16%, 13%);
                padding: 2px 6px;
                border-radius: 4px;
                border: 1px solid hsl(220, 14%, 20%);
            }

            .cmd-empty {
                padding: 24px;
                text-align: center;
                color: hsl(215, 12%, 45%);
                font-size: 0.85rem;
            }

            .cmd-footer {
                display: flex;
                justify-content: center;
                gap: 16px;
                padding: 10px;
                border-top: 1px solid hsl(220, 14%, 16%);
                font-size: 0.7rem;
                color: hsl(215, 12%, 40%);
            }
            .cmd-footer kbd {
                background: hsl(220, 16%, 15%);
                padding: 1px 5px;
                border-radius: 3px;
                border: 1px solid hsl(220, 14%, 22%);
                font-family: inherit;
                margin: 0 2px;
            }
        `;
        document.head.appendChild(style);
    }

    _createDOM() {
        this.overlay = document.createElement('div');
        this.overlay.className = 'cmd-overlay';
        this.overlay.setAttribute('role', 'dialog');
        this.overlay.setAttribute('aria-label', 'פלטת פקודות');
        this.overlay.innerHTML = `
            <div class="cmd-dialog">
                <div class="cmd-input-wrap">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    </svg>
                    <input class="cmd-input" type="text" placeholder="חפש פעולה, עמוד, או פקודה..." autocomplete="off">
                    <span class="cmd-shortcut-hint">ESC</span>
                </div>
                <div class="cmd-list"></div>
                <div class="cmd-footer">
                    <span><kbd>Enter</kbd> לבחירה</span>
                    <span><kbd>^</kbd><kbd>v</kbd> לניווט</span>
                    <span><kbd>Esc</kbd> לסגירה</span>
                </div>
            </div>
        `;

        document.body.appendChild(this.overlay);
        this.inputEl = this.overlay.querySelector('.cmd-input');
        this.listEl = this.overlay.querySelector('.cmd-list');
    }

    _bindEvents() {
        // Cmd/Ctrl + Shift + K to open (avoid Ctrl+K Chrome conflict)
        document.addEventListener('keydown', (e) => {
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'k' || e.key === 'K')) {
                e.preventDefault();
                this.toggle();
            }
        });

        // Close on overlay click
        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) this.close();
        });

        // Input events
        this.inputEl.addEventListener('input', () => this._filter());
        this.inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { this.close(); return; }
            if (e.key === 'ArrowDown') { e.preventDefault(); this._moveSelection(1); }
            if (e.key === 'ArrowUp') { e.preventDefault(); this._moveSelection(-1); }
            if (e.key === 'Enter') {
                e.preventDefault();
                if (this.filteredCommands[this.selectedIndex]) {
                    this._execute(this.filteredCommands[this.selectedIndex]);
                }
            }
        });
    }

    toggle() {
        this.isOpen ? this.close() : this.open();
    }

    open() {
        this.isOpen = true;
        this.overlay.classList.add('open');
        this.inputEl.value = '';
        this.selectedIndex = 0;
        this._filter();
        requestAnimationFrame(() => this.inputEl.focus());
    }

    close() {
        this.isOpen = false;
        this.overlay.classList.remove('open');
    }

    _filter() {
        const q = this.inputEl.value.trim().toLowerCase();
        this.filteredCommands = q
            ? this.commands.filter(c =>
                c.title.toLowerCase().includes(q) ||
                (c.description || '').toLowerCase().includes(q) ||
                (c.keywords || []).some(k => k.includes(q))
            )
            : this.commands;

        this.selectedIndex = 0;
        this._render();
    }

    _render() {
        if (this.filteredCommands.length === 0) {
            this.listEl.innerHTML = '<div class="cmd-empty">לא נמצאו תוצאות</div>';
            return;
        }

        this.listEl.innerHTML = this.filteredCommands.map((cmd, i) => `
            <div class="cmd-item${i === this.selectedIndex ? ' selected' : ''}" data-index="${i}">
                <div class="cmd-item-icon">${cmd.icon || ''}</div>
                <div class="cmd-item-text">
                    <div class="cmd-item-title">${cmd.title}</div>
                    ${cmd.description ? `<div class="cmd-item-desc">${cmd.description}</div>` : ''}
                </div>
                ${cmd.shortcut ? `<span class="cmd-item-shortcut">${cmd.shortcut}</span>` : ''}
            </div>
        `).join('');

        // Click handlers
        this.listEl.querySelectorAll('.cmd-item').forEach(el => {
            el.addEventListener('click', () => {
                this._execute(this.filteredCommands[parseInt(el.dataset.index)]);
            });
        });
    }

    _moveSelection(delta) {
        this.selectedIndex = Math.max(0, Math.min(this.filteredCommands.length - 1, this.selectedIndex + delta));
        this._render();
        // Scroll selected item into view
        const selected = this.listEl.querySelector('.cmd-item.selected');
        if (selected) selected.scrollIntoView({ block: 'nearest' });
    }

    _execute(cmd) {
        this.close();
        if (cmd.action) cmd.action();
        this.onExecute(cmd);
    }

    setCommands(commands) {
        this.commands = commands;
    }

    destroy() {
        this.overlay?.remove();
        document.getElementById('cmd-palette-styles')?.remove();
    }
}

// ==================== SMART INSIGHTS WIDGET ====================

class SmartInsightsWidget {
    constructor(options = {}) {
        this.getFinanceData = options.getFinanceData || (() => ({}));
        this.container = options.container || null;
    }

    // Helper: get full monthly summary including fixed incomes/expenses
    _getMonthData(month) {
        const data = this.getFinanceData();
        const transactions = data.transactions || [];
        const fixedIncomes = data.fixedIncomes || [];
        const fixedExpenses = data.fixedExpenses || [];

        const monthTx = transactions.filter(t => t.month === month && t.type !== 'manual-tithe');
        let inc = monthTx.filter(t => t.type === 'income').reduce((s, t) => s + (t.amt || 0), 0);
        let exp = monthTx.filter(t => t.type === 'expense').reduce((s, t) => s + (t.amt || 0), 0);

        const inRange = (m, start, end) => start && end && m >= start && m <= end;
        fixedIncomes.forEach(f => { if (inRange(month, f.start, f.end)) inc += f.amount; });
        fixedExpenses.forEach(f => { if (inRange(month, f.start, f.end)) exp += f.amount; });

        // Expense by category
        const catSpend = {};
        monthTx.filter(t => t.type === 'expense').forEach(t => {
            catSpend[t.cat || 'אחר'] = (catSpend[t.cat || 'אחר'] || 0) + (t.amt || 0);
        });
        fixedExpenses.forEach(f => {
            if (inRange(month, f.start, f.end)) {
                catSpend[f.category || 'אחר'] = (catSpend[f.category || 'אחר'] || 0) + f.amount;
            }
        });

        // Income sources
        const incomeSources = new Set();
        monthTx.filter(t => t.type === 'income').forEach(t => incomeSources.add(t.cat));
        fixedIncomes.forEach(f => { if (inRange(month, f.start, f.end)) incomeSources.add(f.category); });

        return { inc, exp, bal: inc - exp, catSpend, incomeSources, txCount: monthTx.length };
    }

    generateInsights(overrideMonth) {
        const data = this.getFinanceData();
        const budgets = data.budgets || {};

        const now = new Date();
        let currentMonth;
        if (overrideMonth) {
            // Validate overrideMonth format "YYYY-MM"
            const parts = overrideMonth.split('-').map(Number);
            if (parts.length === 2 && parts[0] > 1900 && parts[1] >= 1 && parts[1] <= 12) {
                currentMonth = overrideMonth;
            } else {
                currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            }
        } else {
            currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        }
        const [cy, cm] = currentMonth.split('-').map(Number);
        const prevDate = new Date(cy, cm - 2);
        const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
        const monthLabel = new Date(cy, cm - 1).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });

        const current = this._getMonthData(currentMonth);
        const prev = this._getMonthData(prevMonth);
        const fmt = (n) => `₪${Math.round(n).toLocaleString()}`;

        const insights = [];

        // ========== Detailed Financial Health Score ==========
        const savingsRate = current.inc > 0 ? (current.bal / current.inc) : 0;
        const scoreBreakdown = [];
        let healthScore = 0;

        // 1. Savings Rate (0-30 points)
        let savingsPoints = 0;
        if (savingsRate >= 0.2) savingsPoints = 30;
        else if (savingsRate >= 0.15) savingsPoints = 25;
        else if (savingsRate >= 0.1) savingsPoints = 20;
        else if (savingsRate >= 0.05) savingsPoints = 12;
        else if (savingsRate >= 0) savingsPoints = 5;
        else savingsPoints = 0;
        healthScore += savingsPoints;
        scoreBreakdown.push({ label: `חיסכון (${Math.round(savingsRate * 100)}%)`, points: savingsPoints, max: 30 });

        // 2. Budget Adherence (0-25 points)
        let budgetPoints = 0;
        const budgetEntries = Object.entries(budgets);
        if (budgetEntries.length > 0) {
            let withinBudget = 0;
            budgetEntries.forEach(([cat, budget]) => {
                if ((current.catSpend[cat] || 0) <= budget) withinBudget++;
            });
            budgetPoints = Math.round((withinBudget / budgetEntries.length) * 25);
        } else {
            budgetPoints = 10; // Partial credit for no budgets set
        }
        healthScore += budgetPoints;
        scoreBreakdown.push({ label: `עמידה בתקציב`, points: budgetPoints, max: 25 });

        // 3. Expense Stability (0-20 points) - compared to previous month
        let stabilityPoints = 10; // base
        if (prev.exp > 0) {
            const expChange = Math.abs((current.exp - prev.exp) / prev.exp);
            if (expChange <= 0.05) stabilityPoints = 20;
            else if (expChange <= 0.15) stabilityPoints = 15;
            else if (expChange <= 0.3) stabilityPoints = 10;
            else stabilityPoints = 5;
        }
        healthScore += stabilityPoints;
        scoreBreakdown.push({ label: 'יציבות הוצאות', points: stabilityPoints, max: 20 });

        // 4. Income Diversity (0-15 points)
        const sourceCount = current.incomeSources.size;
        let diversityPoints = sourceCount >= 3 ? 15 : sourceCount >= 2 ? 10 : sourceCount >= 1 ? 5 : 0;
        healthScore += diversityPoints;
        scoreBreakdown.push({ label: `גיוון הכנסות (${sourceCount} מקורות)`, points: diversityPoints, max: 15 });

        // 5. Data completeness (0-10 points)
        let dataPoints = 0;
        if (current.inc > 0) dataPoints += 3;
        if (current.exp > 0) dataPoints += 3;
        if (budgetEntries.length > 0) dataPoints += 2;
        if ((data.fixedIncomes || []).length > 0 || (data.fixedExpenses || []).length > 0) dataPoints += 2;
        healthScore += dataPoints;
        scoreBreakdown.push({ label: 'שלמות נתונים', points: dataPoints, max: 10 });

        healthScore = Math.min(100, Math.max(0, healthScore));

        // Build description with breakdown
        let healthDesc = '';
        if (healthScore >= 80) healthDesc = 'מצוין! המצב הפיננסי שלך יציב ובריא';
        else if (healthScore >= 65) healthDesc = 'טוב - יש מקום קטן לשיפור';
        else if (healthScore >= 45) healthDesc = 'בינוני - כדאי לשפר כמה נקודות';
        else healthDesc = 'דורש תשומת לב - יש מקום משמעותי לשיפור';

        insights.push({
            type: 'health-score',
            score: healthScore,
            breakdown: scoreBreakdown,
            title: `ציון בריאות פיננסית - ${monthLabel}`,
            description: healthDesc,
            color: healthScore >= 80 ? '#22c55e' : healthScore >= 65 ? '#eab308' : healthScore >= 45 ? '#f97316' : '#ef4444'
        });

        // ========== Anomaly detection (using full data) ==========
        Object.entries(current.catSpend).forEach(([cat, amt]) => {
            const prevAmt = prev.catSpend[cat] || 0;
            if (prevAmt > 0 && amt > prevAmt * 1.5) {
                insights.push({
                    type: 'anomaly',
                    title: `חריגה ב${cat}`,
                    description: `${fmt(amt)} - עליה של ${Math.round(((amt - prevAmt) / prevAmt) * 100)}% (חודש קודם: ${fmt(prevAmt)})`,
                    color: '#ef4444',
                    icon: '⚠'
                });
            }
        });

        // Predictive spending
        if (current.exp > 0) {
            const dayOfMonth = now.getDate();
            const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
            const projectedExpense = Math.round((current.exp / dayOfMonth) * daysInMonth);

            if (projectedExpense > current.inc * 0.95 && current.inc > 0) {
                insights.push({
                    type: 'prediction',
                    title: 'חיזוי: חריגה צפויה',
                    description: `בקצב הנוכחי, ההוצאות צפויות להגיע ל-${fmt(projectedExpense)} (הכנסות: ${fmt(current.inc)})`,
                    color: '#f97316',
                    icon: '📊'
                });
            }
        }

        // Savings recommendation
        if (savingsRate > 0 && savingsRate < 0.2 && current.inc > 0) {
            const neededSave = Math.round(current.inc * 0.2 - current.bal);
            insights.push({
                type: 'recommendation',
                title: 'המלצת חיסכון',
                description: `כדי להגיע ל-20% חיסכון, צריך לחסוך עוד ${fmt(neededSave)} החודש`,
                color: '#3b82f6',
                icon: '💡'
            });
        }

        // Budget overruns
        budgetEntries.forEach(([cat, budget]) => {
            const spent = current.catSpend[cat] || 0;
            if (spent > budget * 1.2) {
                insights.push({
                    type: 'budget-alert',
                    title: `חריגת תקציב: ${cat}`,
                    description: `${fmt(spent)} מתוך ${fmt(budget)} (${Math.round((spent/budget)*100)}%)`,
                    color: '#ef4444',
                    icon: '🔴'
                });
            }
        });

        return insights;
    }

    render(targetEl, month) {
        const el = targetEl || this.container;
        if (!el) return;

        const insights = this.generateInsights(month);
        if (insights.length === 0) {
            el.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 20px;">אין מספיק נתונים לתובנות</p>';
            return;
        }

        const healthInsight = insights.find(i => i.type === 'health-score');
        const otherInsights = insights.filter(i => i.type !== 'health-score');

        el.innerHTML = `
            <div style="display: grid; gap: 12px;">
                ${healthInsight ? `
                <div style="
                    background: hsl(220, 16%, 12%);
                    border: 1px solid hsl(220, 14%, 18%);
                    border-radius: 12px;
                    padding: 20px;
                    animation: fadeInUp 0.5s ease both;
                ">
                    <div style="display: flex; align-items: center; gap: 20px; margin-bottom: 16px;">
                        <div style="
                            width: 72px;
                            height: 72px;
                            border-radius: 50%;
                            background: conic-gradient(${healthInsight.color} ${healthInsight.score * 3.6}deg, hsl(220, 14%, 18%) 0deg);
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            flex-shrink: 0;
                        ">
                            <div style="
                                width: 56px;
                                height: 56px;
                                border-radius: 50%;
                                background: hsl(220, 16%, 12%);
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                font-size: 1.2rem;
                                font-weight: 700;
                                color: ${healthInsight.color};
                                font-family: 'JetBrains Mono', monospace;
                            ">${healthInsight.score}</div>
                        </div>
                        <div>
                            <div style="color: hsl(210, 20%, 92%); font-weight: 600; margin-bottom: 4px;">${healthInsight.title}</div>
                            <div style="color: hsl(215, 12%, 52%); font-size: 0.8rem;">${healthInsight.description}</div>
                        </div>
                    </div>
                    ${healthInsight.breakdown ? `
                    <div style="display: grid; gap: 6px;">
                        ${healthInsight.breakdown.map(b => {
                            const pct = Math.round((b.points / b.max) * 100);
                            const barColor = pct >= 80 ? '#22c55e' : pct >= 50 ? '#eab308' : pct >= 30 ? '#f97316' : '#ef4444';
                            return `<div style="display: flex; align-items: center; gap: 8px; font-size: 0.72rem;">
                                <div style="width: 120px; color: hsl(215, 12%, 58%); text-align: left; flex-shrink: 0;">${b.label}</div>
                                <div style="flex: 1; height: 6px; background: hsl(220, 14%, 18%); border-radius: 3px; overflow: hidden;">
                                    <div style="height: 100%; width: ${pct}%; background: ${barColor}; border-radius: 3px; transition: width 1s ease;"></div>
                                </div>
                                <div style="width: 40px; color: hsl(215, 12%, 48%); font-family: 'JetBrains Mono', monospace; font-size: 0.65rem;">${b.points}/${b.max}</div>
                            </div>`;
                        }).join('')}
                    </div>` : ''}
                </div>` : ''}

                ${otherInsights.map((insight, i) => `
                <div style="
                    background: hsl(220, 16%, 12%);
                    border: 1px solid hsl(220, 14%, 18%);
                    border-right: 3px solid ${insight.color};
                    border-radius: 10px;
                    padding: 14px 16px;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    animation: fadeInUp ${0.3 + i * 0.1}s ease both;
                ">
                    <div style="
                        width: 32px;
                        height: 32px;
                        border-radius: 8px;
                        background: ${insight.color}15;
                        color: ${insight.color};
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        font-weight: 700;
                        font-size: 0.85rem;
                        flex-shrink: 0;
                    ">${insight.icon || '*'}</div>
                    <div>
                        <div style="color: hsl(210, 20%, 90%); font-weight: 500; font-size: 0.85rem;">${insight.title}</div>
                        <div style="color: hsl(215, 12%, 52%); font-size: 0.75rem; margin-top: 2px;">${insight.description}</div>
                    </div>
                </div>`).join('')}
            </div>
        `;
    }
}

// ==================== MICRO-INTERACTIONS MODULE ====================

const MicroInteractions = {
    // Animated count-up for numbers
    countUp(el, target, duration = 1200) {
        const start = 0;
        const startTime = performance.now();
        const isNeg = target < 0;
        const absTarget = Math.abs(target);

        const animate = (now) => {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
            const current = Math.round(start + (absTarget - start) * eased);
            const formatted = new Intl.NumberFormat('he-IL').format(current);
            el.textContent = (isNeg ? '-' : '') + formatted;
            if (progress < 1) requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
    },

    // Staggered fade-in for child elements
    staggerIn(container, selector = ':scope > *', delay = 80) {
        const children = container.querySelectorAll(selector);
        children.forEach((child, i) => {
            child.style.opacity = '0';
            child.style.transform = 'translateY(12px)';
            child.style.transition = `opacity 0.4s ease ${i * delay}ms, transform 0.4s ease ${i * delay}ms`;
            requestAnimationFrame(() => {
                child.style.opacity = '1';
                child.style.transform = 'translateY(0)';
            });
        });
    },

    // Shimmer skeleton loader
    createSkeleton(count = 3) {
        const style = `
            background: linear-gradient(90deg, hsl(220, 16%, 13%) 25%, hsl(220, 16%, 17%) 50%, hsl(220, 16%, 13%) 75%);
            background-size: 200% 100%;
            animation: shimmer 1.5s infinite;
            border-radius: 8px;
            height: 60px;
            margin-bottom: 8px;
        `;
        let html = `<style>@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }</style>`;
        for (let i = 0; i < count; i++) {
            html += `<div style="${style}"></div>`;
        }
        return html;
    },

    // Pulse animation for updated data
    pulse(el) {
        el.style.transition = 'box-shadow 0.3s ease';
        el.style.boxShadow = '0 0 0 3px hsla(142, 60%, 50%, 0.3)';
        setTimeout(() => { el.style.boxShadow = 'none'; }, 1000);
    },

    // Tab transition with fade
    tabTransition(outEl, inEl, direction = 'left') {
        if (outEl) {
            outEl.style.transition = 'opacity 0.15s ease, transform 0.15s ease';
            outEl.style.opacity = '0';
            outEl.style.transform = direction === 'left' ? 'translateX(-12px)' : 'translateX(12px)';
        }

        setTimeout(() => {
            if (outEl) outEl.classList.add('hidden');
            if (inEl) {
                inEl.classList.remove('hidden');
                inEl.style.opacity = '0';
                inEl.style.transform = direction === 'left' ? 'translateX(12px)' : 'translateX(-12px)';
                requestAnimationFrame(() => {
                    inEl.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
                    inEl.style.opacity = '1';
                    inEl.style.transform = 'translateX(0)';
                });
            }
        }, 150);
    }
};

// ==================== EXPORTS ====================

// Make available globally for non-module scripts
window.FinancialAIAssistant = FinancialAIAssistant;
window.CommandPalette = CommandPalette;
window.SmartInsightsWidget = SmartInsightsWidget;
window.MicroInteractions = MicroInteractions;
