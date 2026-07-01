// ============================================================
// RunQuest — utilitaires partagés
// ============================================================

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined) continue;
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---- Formatage ----

export function fmtKm(m, digits = 2) {
  if (m == null || isNaN(m)) return '–';
  return (m / 1000).toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits }) + ' km';
}

export function fmtDuration(sec) {
  if (sec == null || isNaN(sec)) return '–';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}`;
  if (m > 0) return `${m}:${String(s).padStart(2, '0')}`;
  return `${s}s`;
}

export function fmtDurationLong(sec) {
  if (sec == null || isNaN(sec)) return '–';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}min ${String(s).padStart(2, '0')}s`;
  return `${m}min ${String(s).padStart(2, '0')}s`;
}

// allure en sec/km -> "5:30/km"
export function fmtPace(secPerKm, suffix = '/km') {
  if (secPerKm == null || !isFinite(secPerKm) || secPerKm <= 0) return '–';
  const m = Math.floor(secPerKm / 60), s = Math.round(secPerKm % 60);
  return `${m}:${String(s === 60 ? 0 : s).padStart(2, '0')}${suffix}`;
}

// "5:00" -> 300 (sec/km)
export function parsePace(str) {
  if (!str) return null;
  const m = String(str).match(/(\d+)[:'](\d+)/);
  if (!m) return null;
  return parseInt(m[1]) * 60 + parseInt(m[2]);
}

export function paceOf(distanceM, durationSec) {
  if (!distanceM || !durationSec || distanceM < 100) return null;
  return durationSec / (distanceM / 1000);
}

export function fmtDate(d, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  if (!d) return '–';
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date)) return '–';
  return date.toLocaleDateString('fr-FR', opts);
}

export function fmtDateFull(d) {
  return fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export function isoDay(d) {
  const date = d instanceof Date ? d : new Date(d);
  const y = date.getFullYear(), m = String(date.getMonth() + 1).padStart(2, '0'), day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(d, n) {
  const date = new Date(d instanceof Date ? d.getTime() : d);
  date.setDate(date.getDate() + n);
  return date;
}

// Lundi de la semaine ISO contenant d
export function mondayOf(d) {
  const date = new Date(d instanceof Date ? d.getTime() : d);
  const day = (date.getDay() + 6) % 7; // 0 = lundi
  date.setDate(date.getDate() - day);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function weekKey(d) {
  return isoDay(mondayOf(d));
}

export function daysBetween(a, b) {
  return Math.round((mondayOf(b) - mondayOf(a)) / 86400000 / 7);
}

// ---- Statistiques ----

export function mean(arr) {
  const v = arr.filter(x => x != null && isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function sum(arr) {
  return arr.reduce((a, b) => a + (b || 0), 0);
}

export function median(arr) {
  const v = arr.filter(x => x != null && isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

// moyenne glissante sur n points (null-safe)
export function rollingMean(values, n) {
  return values.map((_, i) => {
    const win = values.slice(Math.max(0, i - n + 1), i + 1).filter(v => v != null && isFinite(v));
    return win.length ? win.reduce((a, b) => a + b, 0) / win.length : null;
  });
}

export function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// régression linéaire simple -> {slope, intercept} (x en indices)
export function linearTrend(values) {
  const pts = values.map((v, i) => [i, v]).filter(([, v]) => v != null && isFinite(v));
  if (pts.length < 2) return null;
  const n = pts.length;
  const sx = sum(pts.map(p => p[0])), sy = sum(pts.map(p => p[1]));
  const sxy = sum(pts.map(p => p[0] * p[1])), sxx = sum(pts.map(p => p[0] * p[0]));
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1);
  return { slope, intercept: (sy - slope * sx) / n };
}

// ---- Divers ----

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

let toastTimer = null;
export function toast(msg, type = 'info', ms = 3200) {
  let t = $('#toast');
  if (!t) {
    t = el('div', { id: 'toast' });
    document.body.append(t);
  }
  t.textContent = msg;
  t.className = `show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, ms);
}

// ---- Confettis (gamification) ----
export function confetti(durationMs = 1800) {
  const canvas = el('canvas', { class: 'confetti-canvas' });
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');
  canvas.width = innerWidth; canvas.height = innerHeight;
  const colors = ['#ff6b35', '#ffd23f', '#0ead69', '#3bceac', '#ee4266', '#4361ee'];
  const parts = Array.from({ length: 140 }, () => ({
    x: Math.random() * canvas.width,
    y: -20 - Math.random() * canvas.height * 0.4,
    w: 6 + Math.random() * 6,
    h: 8 + Math.random() * 8,
    vy: 2.2 + Math.random() * 3.4,
    vx: -1.6 + Math.random() * 3.2,
    rot: Math.random() * Math.PI,
    vr: -0.12 + Math.random() * 0.24,
    color: colors[(Math.random() * colors.length) | 0],
  }));
  const start = performance.now();
  (function frame(now) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (now - start < durationMs) requestAnimationFrame(frame);
    else canvas.remove();
  })(start);
}
