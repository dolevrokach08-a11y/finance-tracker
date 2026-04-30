/**
 * Shared chart utilities for the finance tracker.
 * Provides reusable visualization components: heatmaps, sparklines, gauges.
 *
 * Usage:
 *   import { createSparkline, createGauge, createHeatmap, getChartDefaults } from './shared/chart-helpers.js';
 */

/**
 * Detect current theme.
 * @returns {boolean}
 */
function isDark() {
  return document.documentElement.getAttribute('data-theme') !== 'light';
}

/**
 * Get CSS variable value from :root.
 * @param {string} name - e.g. '--accent'
 * @returns {string}
 */
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Get consistent Chart.js defaults for the finance tracker.
 * @returns {object} Chart.js options partial
 */
export function getChartDefaults() {
  const dark = isDark();
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: {
          color: dark ? 'hsl(210,20%,75%)' : 'hsl(220,12%,42%)',
          font: { family: "'Heebo', sans-serif", size: 12 },
        },
      },
      tooltip: {
        backgroundColor: dark ? 'hsl(220,18%,13%)' : 'hsl(0,0%,100%)',
        titleColor: dark ? 'hsl(210,20%,92%)' : 'hsl(220,25%,12%)',
        bodyColor: dark ? 'hsl(210,20%,75%)' : 'hsl(220,12%,42%)',
        borderColor: dark ? 'hsl(220,14%,16%)' : 'hsl(220,12%,88%)',
        borderWidth: 1,
        titleFont: { family: "'Heebo', sans-serif", weight: '600' },
        bodyFont: { family: "'JetBrains Mono', monospace", size: 12 },
        rtl: true,
        textDirection: 'rtl',
        padding: 10,
        cornerRadius: 8,
      },
    },
    scales: {
      x: {
        ticks: {
          color: dark ? 'hsl(215,12%,52%)' : 'hsl(220,10%,58%)',
          font: { family: "'Heebo', sans-serif", size: 11 },
        },
        grid: {
          color: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
        },
      },
      y: {
        ticks: {
          color: dark ? 'hsl(215,12%,52%)' : 'hsl(220,10%,58%)',
          font: { family: "'JetBrains Mono', monospace", size: 11 },
        },
        grid: {
          color: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
        },
      },
    },
  };
}

/**
 * Create an inline SVG sparkline.
 * @param {HTMLElement} container - element to append the SVG into
 * @param {number[]} data - array of numeric values
 * @param {object} [options]
 * @param {string} [options.color] - stroke color (default: accent green)
 * @param {number} [options.width] - SVG width (default: 100)
 * @param {number} [options.height] - SVG height (default: 32)
 * @param {number} [options.strokeWidth] - line width (default: 1.5)
 * @param {boolean} [options.fill] - show fill area under line (default: false)
 * @returns {SVGElement}
 */
export function createSparkline(container, data, options = {}) {
  if (!data || data.length < 2) return null;

  const {
    color = cssVar('--accent') || '#2dd87a',
    width = 100,
    height = 32,
    strokeWidth = 1.5,
    fill = false,
  } = options;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = 2;

  const points = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (width - 2 * pad);
    const y = pad + (1 - (v - min) / range) * (height - 2 * pad);
    return `${x},${y}`;
  });

  const polyline = points.join(' ');

  let fillPath = '';
  if (fill) {
    fillPath = `<polygon points="${points.join(' ')} ${width - pad},${height - pad} ${pad},${height - pad}"
      fill="${color}" fill-opacity="0.1" />`;
  }

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', `${height}px`);
  svg.style.display = 'block';
  svg.innerHTML = `
    ${fillPath}
    <polyline points="${polyline}" fill="none" stroke="${color}"
      stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" />
  `;

  container.innerHTML = '';
  container.appendChild(svg);
  return svg;
}

/**
 * Create a gauge (donut arc) chart.
 * @param {HTMLElement} container
 * @param {number} value - current value (0–max)
 * @param {number} max - maximum value
 * @param {object} [options]
 * @param {string} [options.label] - center label text
 * @param {string} [options.sublabel] - smaller text below value
 * @param {number} [options.size] - diameter in px (default: 160)
 * @param {{min:number, max:number, color:string}[]} [options.zones] - color zones
 * @returns {HTMLElement}
 */
export function createGauge(container, value, max, options = {}) {
  const {
    label = '',
    sublabel = '',
    size = 160,
    zones = [
      { min: 0, max: 0.33, color: cssVar('--loss') || '#ef4444' },
      { min: 0.33, max: 0.66, color: cssVar('--warning') || '#f5a623' },
      { min: 0.66, max: 1, color: cssVar('--profit') || '#2dd87a' },
    ],
  } = options;

  const pct = Math.min(Math.max(value / max, 0), 1);
  const zoneColor = zones.find(z => pct >= z.min && pct <= z.max)?.color || zones[zones.length - 1].color;

  const r = (size - 16) / 2;
  const circumference = 2 * Math.PI * r;
  const arcLength = circumference * 0.75; // 270° arc
  const filledLength = arcLength * pct;
  const cx = size / 2;
  const cy = size / 2;

  const dark = isDark();
  const trackColor = dark ? 'hsl(220,16%,18%)' : 'hsl(220,12%,90%)';
  const textColor = dark ? 'hsl(210,20%,92%)' : 'hsl(220,25%,12%)';
  const mutedColor = dark ? 'hsl(215,12%,52%)' : 'hsl(220,10%,58%)';

  const wrapper = document.createElement('div');
  wrapper.style.cssText = `position:relative;width:${size}px;height:${size}px;margin:0 auto;`;

  wrapper.innerHTML = `
    <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
        stroke="${trackColor}" stroke-width="10"
        stroke-dasharray="${arcLength} ${circumference}"
        stroke-dashoffset="0"
        stroke-linecap="round"
        transform="rotate(135, ${cx}, ${cy})" />
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
        stroke="${zoneColor}" stroke-width="10"
        stroke-dasharray="${filledLength} ${circumference}"
        stroke-dashoffset="0"
        stroke-linecap="round"
        transform="rotate(135, ${cx}, ${cy})"
        style="transition: stroke-dasharray 0.8s cubic-bezier(0.4,0,0.2,1);" />
    </svg>
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;">
      <div style="font-family:'JetBrains Mono',monospace;font-size:${size * 0.18}px;font-weight:700;color:${textColor};">${label}</div>
      ${sublabel ? `<div style="font-size:${size * 0.08}px;color:${mutedColor};margin-top:2px;">${sublabel}</div>` : ''}
    </div>
  `;

  container.innerHTML = '';
  container.appendChild(wrapper);
  return wrapper;
}

/**
 * Create a canvas-based heatmap.
 * @param {HTMLElement} container
 * @param {object} options
 * @param {string[]} options.rowLabels
 * @param {string[]} options.colLabels
 * @param {number[][]} options.values - [row][col] matrix
 * @param {string} [options.colorLow] - color for lowest value
 * @param {string} [options.colorHigh] - color for highest value
 * @param {string} [options.colorMid] - color for midpoint (for diverging scales)
 * @param {number} [options.cellSize] - pixel size per cell (default: 40)
 * @param {(value: number) => string} [options.formatValue] - value formatter for tooltip
 * @returns {HTMLCanvasElement}
 */
export function createHeatmap(container, options) {
  const {
    rowLabels = [],
    colLabels = [],
    values = [],
    colorLow = '#ef4444',
    colorHigh = '#2dd87a',
    colorMid = null,
    cellSize = 40,
    formatValue = (v) => v.toFixed(2),
  } = options;

  const dark = isDark();
  const labelSpace = 100;
  const headerHeight = 40;
  const cols = colLabels.length;
  const rows = rowLabels.length;
  const width = labelSpace + cols * cellSize;
  const height = headerHeight + rows * cellSize;

  const canvas = document.createElement('canvas');
  canvas.width = width * 2; // retina
  canvas.height = height * 2;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2);

  const allValues = values.flat().filter(v => v != null && !isNaN(v));
  const minVal = Math.min(...allValues);
  const maxVal = Math.max(...allValues);

  function interpolateColor(t) {
    if (colorMid) {
      const lowRgb = hexToRgb(colorLow);
      const midRgb = hexToRgb(colorMid);
      const highRgb = hexToRgb(colorHigh);
      if (t < 0.5) {
        const s = t * 2;
        return `rgb(${lerp(lowRgb.r, midRgb.r, s)},${lerp(lowRgb.g, midRgb.g, s)},${lerp(lowRgb.b, midRgb.b, s)})`;
      } else {
        const s = (t - 0.5) * 2;
        return `rgb(${lerp(midRgb.r, highRgb.r, s)},${lerp(midRgb.g, highRgb.g, s)},${lerp(midRgb.b, highRgb.b, s)})`;
      }
    }
    const lowRgb = hexToRgb(colorLow);
    const highRgb = hexToRgb(colorHigh);
    return `rgb(${lerp(lowRgb.r, highRgb.r, t)},${lerp(lowRgb.g, highRgb.g, t)},${lerp(lowRgb.b, highRgb.b, t)})`;
  }

  // Draw column headers
  ctx.fillStyle = dark ? 'hsl(215,12%,52%)' : 'hsl(220,10%,58%)';
  ctx.font = "11px 'Heebo', sans-serif";
  ctx.textAlign = 'center';
  colLabels.forEach((label, i) => {
    ctx.fillText(label, labelSpace + i * cellSize + cellSize / 2, headerHeight - 8);
  });

  // Draw rows
  rows > 0 && values.forEach((row, ri) => {
    // Row label
    ctx.fillStyle = dark ? 'hsl(210,20%,75%)' : 'hsl(220,12%,42%)';
    ctx.font = "12px 'Heebo', sans-serif";
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(rowLabels[ri] || '', labelSpace - 8, headerHeight + ri * cellSize + cellSize / 2);

    // Cells
    row.forEach((val, ci) => {
      const x = labelSpace + ci * cellSize;
      const y = headerHeight + ri * cellSize;

      if (val == null || isNaN(val)) {
        ctx.fillStyle = dark ? 'hsl(220,16%,13%)' : 'hsl(220,15%,94%)';
      } else {
        const t = maxVal === minVal ? 0.5 : (val - minVal) / (maxVal - minVal);
        ctx.fillStyle = interpolateColor(t);
        ctx.globalAlpha = 0.85;
      }

      roundRect(ctx, x + 1, y + 1, cellSize - 2, cellSize - 2, 4);
      ctx.fill();
      ctx.globalAlpha = 1;

      // Value text
      if (val != null && !isNaN(val)) {
        ctx.fillStyle = dark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.8)';
        ctx.font = "10px 'JetBrains Mono', monospace";
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(formatValue(val), x + cellSize / 2, y + cellSize / 2);
      }
    });
  });

  container.innerHTML = '';
  container.appendChild(canvas);
  return canvas;
}

// --- Helpers ---

function hexToRgb(hex) {
  if (hex.startsWith('rgb')) {
    const m = hex.match(/(\d+)/g);
    return m ? { r: +m[0], g: +m[1], b: +m[2] } : { r: 128, g: 128, b: 128 };
  }
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  return {
    r: parseInt(hex.substring(0, 2), 16),
    g: parseInt(hex.substring(2, 4), 16),
    b: parseInt(hex.substring(4, 6), 16),
  };
}

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
