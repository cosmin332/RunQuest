// ============================================================
// RunQuest — helpers Chart.js (thème, cycle de vie, formats)
// ============================================================

import { fmtPace } from './utils.js';

const registry = new Map(); // canvasId -> Chart

export const PALETTE = {
  primary: '#ff6b35',
  primarySoft: 'rgba(255,107,53,.15)',
  green: '#0ead69',
  greenSoft: 'rgba(14,173,105,.15)',
  blue: '#4361ee',
  blueSoft: 'rgba(67,97,238,.12)',
  purple: '#7209b7',
  pink: '#ee4266',
  yellow: '#ffd23f',
  teal: '#3bceac',
  gray: '#8d99ae',
  grid: 'rgba(45,55,72,.08)',
  text: '#4a5568',
};

export function destroyCharts() {
  for (const c of registry.values()) c.destroy();
  registry.clear();
}

export function makeChart(canvas, config) {
  if (!canvas) return null;
  if (registry.has(canvas.id)) registry.get(canvas.id).destroy();
  const chart = new Chart(canvas, applyTheme(config));
  registry.set(canvas.id || `c${registry.size}`, chart);
  return chart;
}

function applyTheme(config) {
  config.options = config.options || {};
  const o = config.options;
  o.responsive = true;
  o.maintainAspectRatio = false;
  o.plugins = o.plugins || {};
  o.plugins.legend = o.plugins.legend ?? { labels: { boxWidth: 12, boxHeight: 12, usePointStyle: true, font: { size: 11 } } };
  o.scales = o.scales || {};
  for (const axis of Object.values(o.scales)) {
    axis.grid = axis.grid || { color: PALETTE.grid };
    axis.ticks = { color: PALETTE.text, font: { size: 10 }, ...(axis.ticks || {}) };
  }
  return config;
}

// Axe Y en allure (sec/km, inversé : plus rapide en haut)
export function paceAxis(extra = {}) {
  return {
    reverse: true,
    ticks: { callback: v => fmtPace(v, ''), color: PALETTE.text, font: { size: 10 } },
    grid: { color: PALETTE.grid },
    ...extra,
  };
}

export const paceTooltip = {
  callbacks: { label: ctx => ` ${ctx.dataset.label || ''} : ${fmtPace(ctx.parsed.y)}` },
};

// Labels de semaine compacts : "29/06"
export function weekLabel(isoMonday) {
  const [, m, d] = isoMonday.split('-');
  return `${d}/${m}`;
}
