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
        this.model = options.model || localStorage.getItem('ai_model') || 'claude-sonnet-4-6';
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
                    <option value="claude-sonnet-4-6" ${this.model === 'claude-sonnet-4-6' ? 'selected' : ''}>Claude Sonnet 4.6 (מהיר, מומלץ)</option>
                    <option value="claude-haiku-4-5-20251001" ${this.model === 'claude-haiku-4-5-20251001' ? 'selected' : ''}>Claude Haiku 4.5 (מהיר מאוד, זול)</option>
                    <option value="claude-opus-4-6" ${this.model === 'claude-opus-4-6' ? 'selected' : ''}>Claude Opus 4.6 (חכם ביותר, יקר)</option>
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

    // ---- Claude API Integration ----
    async _callClaudeAPI(userMessage) {
        const financeData = this.getFinanceData();
        const portfolioData = this.getPortfolioData();

        const systemPrompt = `אתה עוזר פיננסי אישי חכם. אתה מנתח נתונים פיננסיים ומספק תובנות בעברית.
הנה הנתונים הפיננסיים של המשתמש:

עסקאות: ${JSON.stringify((financeData.transactions || []).slice(-50))}
תקציבים: ${JSON.stringify(financeData.budgets || {})}
קטגוריות הכנסה: ${JSON.stringify(financeData.incomeCategories || [])}
קטגוריות הוצאה: ${JSON.stringify(financeData.expenseCategories || [])}
הכנסות קבועות: ${JSON.stringify(financeData.fixedIncomes || [])}
הוצאות קבועות: ${JSON.stringify(financeData.fixedExpenses || [])}

תגיב בצורה קצרה וברורה. השתמש במספרים מדויקים מהנתונים. הצע פעולות קונקרטיות.`;

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
                max_tokens: 1024,
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
            throw new Error(`API Error: ${response.status}`);
        }

        const data = await response.json();
        return data.content[0].text;
    }

    // ---- Local Analysis (No API Key) ----
    async _localAnalysis(query) {
        // Simulate thinking time
        await new Promise(r => setTimeout(r, 600 + Math.random() * 800));

        const data = this.getFinanceData();
        const transactions = data.transactions || [];
        const budgets = data.budgets || {};
        const q = query.toLowerCase();

        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const prevMonth = now.getMonth() === 0
            ? `${now.getFullYear() - 1}-12`
            : `${now.getFullYear()}-${String(now.getMonth()).padStart(2, '0')}`;

        const thisMonthTx = transactions.filter(t => t.month === currentMonth);
        const prevMonthTx = transactions.filter(t => t.month === prevMonth);

        const sumByType = (txs, type) => txs.filter(t => t.type === type).reduce((s, t) => s + (t.amt || 0), 0);
        const sumByCat = (txs, type) => {
            const cats = {};
            txs.filter(t => t.type === type).forEach(t => {
                cats[t.cat || 'אחר'] = (cats[t.cat || 'אחר'] || 0) + (t.amt || 0);
            });
            return cats;
        };

        const fmt = (n) => new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' }).format(n);

        // Monthly summary
        if (q.includes('סכם') || q.includes('סיכום') || q.includes('חודש')) {
            const income = sumByType(thisMonthTx, 'income');
            const expense = sumByType(thisMonthTx, 'expense');
            const savings = income - expense;
            const savingsRate = income > 0 ? ((savings / income) * 100).toFixed(1) : 0;

            return `**סיכום חודשי - ${currentMonth}**\n\n` +
                `הכנסות: **${fmt(income)}**\n` +
                `הוצאות: **${fmt(expense)}**\n` +
                `חיסכון: **${fmt(savings)}** (${savingsRate}%)\n\n` +
                (savings > 0
                    ? `מצוין! את/ה חוסכ/ת ${savingsRate}% מההכנסה.`
                    : `שים לב - ההוצאות עולות על ההכנסות. מומלץ לבדוק את הקטגוריות הגדולות.`);
        }

        // Savings tips
        if (q.includes('חסוך') || q.includes('חיסכון') || q.includes('טיפ')) {
            const cats = sumByCat(thisMonthTx, 'expense');
            const sorted = Object.entries(cats).sort((a, b) => b[1] - a[1]);
            const top3 = sorted.slice(0, 3);

            let tips = '**טיפים לחיסכון:**\n\n';
            top3.forEach(([cat, amt], i) => {
                const budget = budgets[cat];
                if (budget && amt > budget) {
                    tips += `${i + 1}. **${cat}**: הוצאת ${fmt(amt)} מתוך תקציב של ${fmt(budget)} - חריגה של ${fmt(amt - budget)}\n`;
                } else {
                    tips += `${i + 1}. **${cat}**: ${fmt(amt)} - הקטגוריה הגדולה ביותר\n`;
                }
            });

            tips += `\nנסה להגדיר תקציב לכל קטגוריה ולעקוב אחרי החריגות.`;
            return tips;
        }

        // Budget status
        if (q.includes('תקציב')) {
            const cats = sumByCat(thisMonthTx, 'expense');
            const budgetEntries = Object.entries(budgets);

            if (budgetEntries.length === 0) {
                return 'לא הוגדרו תקציבים עדיין. לך להגדרות כדי להגדיר תקציב לכל קטגוריה.';
            }

            let status = '**מצב תקציב:**\n\n';
            let overBudget = 0;
            budgetEntries.forEach(([cat, budget]) => {
                const spent = cats[cat] || 0;
                const pct = budget > 0 ? ((spent / budget) * 100).toFixed(0) : 0;
                const bar = pct >= 100 ? '!' : pct >= 80 ? '~' : '+';
                status += `${bar} **${cat}**: ${fmt(spent)} / ${fmt(budget)} (${pct}%)\n`;
                if (spent > budget) overBudget++;
            });

            if (overBudget > 0) {
                status += `\n${overBudget} קטגוריות חרגו מהתקציב. שים לב!`;
            } else {
                status += '\nכל הקטגוריות בתוך התקציב - כל הכבוד!';
            }
            return status;
        }

        // Expense analysis
        if (q.includes('נתח') || q.includes('ניתוח') || q.includes('הוצאות')) {
            const cats = sumByCat(thisMonthTx, 'expense');
            const prevCats = sumByCat(prevMonthTx, 'expense');
            const totalExp = sumByType(thisMonthTx, 'expense');

            let analysis = '**ניתוח הוצאות:**\n\n';
            const sorted = Object.entries(cats).sort((a, b) => b[1] - a[1]);

            sorted.slice(0, 5).forEach(([cat, amt]) => {
                const pct = totalExp > 0 ? ((amt / totalExp) * 100).toFixed(1) : 0;
                const prevAmt = prevCats[cat] || 0;
                const change = prevAmt > 0 ? (((amt - prevAmt) / prevAmt) * 100).toFixed(0) : 0;
                const trend = change > 10 ? ' (עליה)' : change < -10 ? ' (ירידה)' : '';
                analysis += `**${cat}**: ${fmt(amt)} (${pct}%)${trend}\n`;
            });

            if (sorted.length === 0) {
                analysis += 'אין עסקאות החודש עדיין.';
            }

            return analysis;
        }

        // Income analysis
        if (q.includes('הכנסה') || q.includes('הכנסות') || q.includes('משכורת')) {
            const income = sumByType(thisMonthTx, 'income');
            const prevIncome = sumByType(prevMonthTx, 'income');
            const change = prevIncome > 0 ? (((income - prevIncome) / prevIncome) * 100).toFixed(1) : 0;
            const incomeCats = sumByCat(thisMonthTx, 'income');

            let text = `**סיכום הכנסות - ${currentMonth}**\n\n`;
            text += `סה"כ: **${fmt(income)}**\n`;
            if (prevIncome > 0) text += `שינוי מחודש קודם: ${change}%\n`;
            text += '\n';
            Object.entries(incomeCats).forEach(([cat, amt]) => {
                text += `${cat}: ${fmt(amt)}\n`;
            });
            return text;
        }

        // Default
        return 'אני יכול לעזור עם:\n\n' +
            '- **סיכום חודשי** - סקירה של הכנסות והוצאות\n' +
            '- **טיפים לחיסכון** - איפה אפשר לחסוך\n' +
            '- **מצב תקציב** - עמידה ביעדים\n' +
            '- **ניתוח הוצאות** - פילוח לפי קטגוריות\n' +
            '- **ניתוח הכנסות** - סקירת מקורות הכנסה\n\n' +
            'נסה לשאול אחת מהשאלות האלה!';
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
        this.model = 'claude-sonnet-4-6';

        const keyInput = this.panel.querySelector('#aiApiKeyInput');
        const modelSelect = this.panel.querySelector('#aiModelSelect');
        if (keyInput) keyInput.value = '';
        if (modelSelect) modelSelect.value = 'claude-sonnet-4-6';

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
            'claude-sonnet-4-6': 'Claude Sonnet 4.6',
            'claude-haiku-4-5-20251001': 'Claude Haiku 4.5',
            'claude-opus-4-6': 'Claude Opus 4.6'
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
        // Cmd/Ctrl + K to open
        document.addEventListener('keydown', (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
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

    generateInsights() {
        const data = this.getFinanceData();
        const transactions = data.transactions || [];
        const budgets = data.budgets || {};

        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const prevMonth = now.getMonth() === 0
            ? `${now.getFullYear() - 1}-12`
            : `${now.getFullYear()}-${String(now.getMonth()).padStart(2, '0')}`;

        const thisMonthTx = transactions.filter(t => t.month === currentMonth);
        const prevMonthTx = transactions.filter(t => t.month === prevMonth);

        const insights = [];

        // Financial Health Score
        const income = thisMonthTx.filter(t => t.type === 'income').reduce((s, t) => s + (t.amt || 0), 0);
        const expense = thisMonthTx.filter(t => t.type === 'expense').reduce((s, t) => s + (t.amt || 0), 0);
        const savingsRate = income > 0 ? (income - expense) / income : 0;

        let healthScore = 50;
        if (savingsRate >= 0.2) healthScore += 20;
        else if (savingsRate >= 0.1) healthScore += 10;
        else if (savingsRate < 0) healthScore -= 20;

        // Budget adherence
        const catSpend = {};
        thisMonthTx.filter(t => t.type === 'expense').forEach(t => {
            catSpend[t.cat || 'אחר'] = (catSpend[t.cat || 'אחר'] || 0) + (t.amt || 0);
        });
        let budgetOK = 0, budgetTotal = 0;
        Object.entries(budgets).forEach(([cat, budget]) => {
            budgetTotal++;
            if ((catSpend[cat] || 0) <= budget) budgetOK++;
        });
        if (budgetTotal > 0) {
            healthScore += (budgetOK / budgetTotal) * 20;
        }

        // Diversity of income
        const incomeSourceCount = new Set(thisMonthTx.filter(t => t.type === 'income').map(t => t.cat)).size;
        if (incomeSourceCount >= 2) healthScore += 10;

        healthScore = Math.min(100, Math.max(0, Math.round(healthScore)));

        insights.push({
            type: 'health-score',
            score: healthScore,
            title: 'ציון בריאות פיננסית',
            description: healthScore >= 80 ? 'מצוין! המצב הפיננסי שלך יציב'
                : healthScore >= 60 ? 'טוב, יש מקום לשיפור'
                : healthScore >= 40 ? 'בינוני - שים לב להוצאות'
                : 'דורש תשומת לב - יש חריגות משמעותיות',
            color: healthScore >= 80 ? '#22c55e' : healthScore >= 60 ? '#eab308' : healthScore >= 40 ? '#f97316' : '#ef4444'
        });

        // Anomaly detection
        const prevCatSpend = {};
        prevMonthTx.filter(t => t.type === 'expense').forEach(t => {
            prevCatSpend[t.cat || 'אחר'] = (prevCatSpend[t.cat || 'אחר'] || 0) + (t.amt || 0);
        });

        Object.entries(catSpend).forEach(([cat, amt]) => {
            const prev = prevCatSpend[cat] || 0;
            if (prev > 0 && amt > prev * 1.5) {
                insights.push({
                    type: 'anomaly',
                    title: `חריגה ב${cat}`,
                    description: `עליה של ${Math.round(((amt - prev) / prev) * 100)}% לעומת חודש קודם`,
                    color: '#ef4444',
                    icon: '!'
                });
            }
        });

        // Predictive spending
        if (thisMonthTx.length > 0) {
            const dayOfMonth = now.getDate();
            const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
            const projectedExpense = (expense / dayOfMonth) * daysInMonth;

            if (projectedExpense > income * 0.95 && income > 0) {
                insights.push({
                    type: 'prediction',
                    title: 'חיזוי: חריגה צפויה',
                    description: `בקצב הנוכחי, ההוצאות צפויות להגיע ל-${new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' }).format(projectedExpense)}`,
                    color: '#f97316',
                    icon: '~'
                });
            }
        }

        // Savings recommendation
        if (savingsRate > 0 && savingsRate < 0.2) {
            const neededSave = income * 0.2 - (income - expense);
            insights.push({
                type: 'recommendation',
                title: 'המלצת חיסכון',
                description: `כדי להגיע ל-20% חיסכון, צריך לחסוך עוד ${new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' }).format(neededSave)} החודש`,
                color: '#3b82f6',
                icon: 'i'
            });
        }

        return insights;
    }

    render(targetEl) {
        const el = targetEl || this.container;
        if (!el) return;

        const insights = this.generateInsights();
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
                    display: flex;
                    align-items: center;
                    gap: 20px;
                    animation: fadeInUp 0.5s ease both;
                ">
                    <div style="
                        width: 72px;
                        height: 72px;
                        border-radius: 50%;
                        background: conic-gradient(${healthInsight.color} ${healthInsight.score * 3.6}deg, hsl(220, 14%, 18%) 0deg);
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        flex-shrink: 0;
                        position: relative;
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
