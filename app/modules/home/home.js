import { deriveMetrics } from './metrics.js';

function currency(value, { compact = false } = {}) {
    if (!Number.isFinite(value)) return '—';
    const abs = Math.abs(value);
    const sign = value < 0 ? '-' : '';
    if (compact && abs >= 1_000_000) return `${sign}₪${(abs / 1_000_000).toFixed(1)}M`;
    if (compact && abs >= 1_000) return `${sign}₪${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
    return `${sign}₪${Math.round(abs).toLocaleString('he-IL')}`;
}

const MONTH_NAMES = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

// finance.html keys its summary by 'YYYY-MM'.
function monthName(key) {
    const parts = /^(\d{4})-(\d{2})$/.exec(String(key || ''));
    return parts ? (MONTH_NAMES[Number(parts[2]) - 1] || '') : '';
}
// A share or a progress level: no sign, because it is not a change.
function ratio(value) {
    if (!Number.isFinite(value)) return '—';
    return `${value.toFixed(1)}%`;
}

function percent(value) {
    if (!Number.isFinite(value)) return '—';
    return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function text(root, id, value) {
    const node = root.querySelector(`#${id}`);
    if (node) node.textContent = value;
}

function greeting() {
    const hour = new Date().getHours();
    if (hour < 12) return 'בוקר טוב';
    if (hour < 17) return 'צהריים טובים';
    return 'ערב טוב';
}

function drawSparkline(canvas, values) {
    const empty = canvas.parentElement.querySelector('#chartEmpty');
    if (!Array.isArray(values) || values.length < 2) {
        canvas.hidden = true;
        empty.hidden = false;
        return;
    }
    canvas.hidden = false;
    empty.hidden = true;

    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const context = canvas.getContext('2d');
    context.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const points = values.map((value, index) => ({
        x: (index / (values.length - 1)) * width,
        y: height - 7 - ((value - min) / range) * (height - 16),
    }));

    const line = new Path2D();
    line.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
        const previous = points[index - 1];
        const current = points[index];
        const controlX = (previous.x + current.x) / 2;
        line.bezierCurveTo(controlX, previous.y, controlX, current.y, current.x, current.y);
    }

    const gradient = context.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, 'rgba(201,255,71,.25)');
    gradient.addColorStop(1, 'rgba(201,255,71,0)');
    const area = new Path2D(line);
    area.lineTo(width, height);
    area.lineTo(0, height);
    area.closePath();
    context.fillStyle = gradient;
    context.fill(area);
    context.strokeStyle = '#c9ff47';
    context.lineWidth = 2;
    context.lineCap = 'round';
    context.stroke(line);
}

function renderActivity(root, items) {
    const list = root.querySelector('#activityList');
    if (!items.length) {
        list.innerHTML = '<div class="empty-list"><span class="activity-empty-dot"></span><span>פעילות בתיק תופיע כאן</span></div>';
        return;
    }
    list.replaceChildren(...items.map(item => {
        const row = document.createElement('div');
        row.className = `activity-item activity-${item.type}`;
        const marker = document.createElement('span');
        marker.className = 'activity-marker';
        const copy = document.createElement('span');
        copy.className = 'activity-copy';
        const label = document.createElement('strong');
        label.textContent = item.label;
        const date = document.createElement('small');
        date.textContent = new Date(item.date).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' });
        copy.append(label, date);
        const amount = document.createElement('b');
        amount.textContent = currency(item.amount);
        row.append(marker, copy, amount);
        return row;
    }));
}

function renderAllocation(root, allocation) {
    const bar = root.querySelector('#allocationBar');
    const list = root.querySelector('#allocationList');
    const total = allocation.reduce((value, item) => value + item.value, 0);
    if (!total) {
        bar.replaceChildren();
        list.innerHTML = '<div class="empty-list"><span>הקצאה תופיע לאחר הוספת נכסים</span></div>';
        return;
    }
    bar.replaceChildren(...allocation.map(item => {
        const segment = document.createElement('span');
        segment.style.width = `${(item.value / total) * 100}%`;
        segment.style.background = item.color;
        segment.title = `${item.label}: ${percent((item.value / total) * 100)}`;
        return segment;
    }));
    list.replaceChildren(...allocation.map(item => {
        const row = document.createElement('div');
        row.className = 'allocation-item';
        const label = document.createElement('span');
        label.innerHTML = `<i style="--item-color:${item.color}"></i>`;
        label.append(document.createTextNode(item.label));
        const value = document.createElement('b');
        value.textContent = percent((item.value / total) * 100);
        row.append(label, value);
        return row;
    }));
}

export function mount({ root, store }) {
    const canvas = root.querySelector('#portfolioSparkline');
    let lastHistory = [];

    function render(state) {
        const metrics = deriveMetrics(state.data);
        const { portfolio, finance, mortgage } = metrics;
        const firstName = state.session.user?.displayName?.split(/\s+/)[0];
        text(root, 'greetingText', `${greeting()}${firstName ? `, ${firstName}` : ''}`);
        text(root, 'heroSyncLabel', state.cloud.status === 'ready' ? 'הנתונים מעודכנים' : state.cloud.status === 'syncing' ? 'מסנכרן עם הענן' : state.cloud.status === 'demo' ? 'מצב הדגמה' : 'נתונים מקומיים זמינים');
        root.querySelector('#demoRibbon').hidden = !state.session.isDemo;

        text(root, 'heroNetWorth', metrics.hasData ? currency(metrics.combinedNetWorth) : '—');
        const returnNode = root.querySelector('#heroReturn');
        returnNode.hidden = !Number.isFinite(portfolio.returnPct);
        if (!returnNode.hidden) {
            returnNode.querySelector('b').textContent = percent(portfolio.returnPct);
            returnNode.classList.toggle('is-negative', portfolio.returnPct < 0);
        }

        const connected = [state.data.portfolio, state.data.finance, state.data.mortgage].filter(Boolean).length;
        text(root, 'orbitScore', `${Math.round((connected / 3) * 100)}%`);
        text(root, 'orbitPortfolio', portfolio.total ? currency(portfolio.total, { compact: true }) : '—');
        text(root, 'orbitCashflow', finance.hasCashflow ? currency(finance.freeCash, { compact: true }) : '—');
        const cashflowMonth = monthName(finance.month);
        text(root, 'orbitCashflowLabel', cashflowMonth ? `תזרים · ${cashflowMonth}` : 'תזרים');
        text(root, 'orbitDebt', mortgage.balance ? currency(mortgage.balance, { compact: true }) : mortgage.monthlyPayment ? currency(mortgage.monthlyPayment, { compact: true }) : '—');

        text(root, 'portfolioValue', portfolio.total ? currency(portfolio.total) : '—');
        text(root, 'portfolioReturn', percent(portfolio.returnPct));
        const returnValue = root.querySelector('#portfolioReturn');
        returnValue.classList.toggle('negative', Number.isFinite(portfolio.returnPct) && portfolio.returnPct < 0);

        text(root, 'monthlyMargin', finance.hasCashflow ? currency(finance.freeCash) : '—');
        text(root, 'monthlyIncome', finance.income ? currency(finance.income) : '—');
        const marginPercent = finance.income > 0 ? Math.max(0, Math.min(100, (finance.freeCash / finance.income) * 100)) : 0;
        root.querySelector('#marginScale').style.width = `${marginPercent}%`;

        text(root, 'cashValue', portfolio.cash ? currency(portfolio.cash) : '—');
        const cashShare = portfolio.total > 0 ? (portfolio.cash / portfolio.total) * 100 : null;
        text(root, 'cashShare', Number.isFinite(cashShare) ? `${cashShare.toFixed(0)}% מהתיק זמין ללא מכירת נכסים` : 'אין מספיק נתונים לחישוב');
        text(root, 'cashShareValue', ratio(cashShare));

        // Three months is the common floor, six the comfortable one — so the bar
        // fills against six rather than against an open-ended scale.
        const months = metrics.emergencyMonths;
        text(root, 'emergencyMonths', Number.isFinite(months) ? `${months.toFixed(1)} חודשים` : '—');
        text(root, 'emergencyAmount', metrics.emergencyCushion ? currency(metrics.emergencyCushion) : '—');
        text(root, 'emergencyCaption', Number.isFinite(months)
            ? (months >= 6 ? 'מכוסה בנוחות' : months >= 3 ? 'מכוסה בבסיס' : 'מתחת לשלושה חודשים')
            : 'חודשי הוצאות מכוסים');
        root.querySelector('#emergencyScale').style.width =
            `${Number.isFinite(months) ? Math.min(100, (months / 6) * 100) : 0}%`;

        text(root, 'firePct', ratio(metrics.firePct));
        text(root, 'fireTarget', metrics.fireTarget ? currency(metrics.fireTarget, { compact: true }) : '—');
        root.querySelector('#fireScale').style.width =
            `${Number.isFinite(metrics.firePct) ? Math.min(100, metrics.firePct) : 0}%`;

        text(root, 'debtRatio', ratio(metrics.debtRatio));
        text(root, 'mortgagePayment', mortgage.monthlyPayment ? currency(mortgage.monthlyPayment) : '—');

        const insight = metrics.insight;
        const insightCard = root.querySelector('#insightCard');
        insightCard.dataset.tone = insight.tone;
        text(root, 'insightEyebrow', insight.eyebrow);
        text(root, 'insightTitle', insight.title);
        text(root, 'insightBody', insight.body);
        const action = root.querySelector('#insightAction');
        action.href = routesToHref[insight.route];
        action.dataset.route = insight.route;
        action.firstChild.textContent = `${insight.action} `;

        renderActivity(root, metrics.recent);
        renderAllocation(root, portfolio.allocation);
        lastHistory = portfolio.history;
        requestAnimationFrame(() => drawSparkline(canvas, lastHistory));

        const updateText = state.cloud.updatedAt
            ? `רענון אחרון ${new Date(state.cloud.updatedAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`
            : state.cloud.status === 'offline' ? 'אין חיבור — הנתונים המקומיים נשארים זמינים' : 'מסנכרן את סביבת העבודה';
        text(root, 'lastCloudUpdate', updateText);
    }

    const routesToHref = {
        portfolio: 'portfolio.html',
        finance: 'finance.html',
        mortgage: 'mortgage.html',
        tax: 'tax-optimizer.html',
    };

    const unsubscribe = store.subscribe(render, { immediate: true });
    const resizeObserver = new ResizeObserver(() => drawSparkline(canvas, lastHistory));
    resizeObserver.observe(canvas.parentElement);

    return () => {
        unsubscribe();
        resizeObserver.disconnect();
    };
}

