// ============================================================
// RunQuest — Vue Stats : Performance · Charge · Santé · Technique · Records
// ============================================================

import { el, fmtKm, fmtPace, fmtDuration, fmtDate, paceOf, rollingMean, mean, fmtDurationLong } from '../utils.js';
import {
  weeklyVolume, acwrSeries, records, predict10k, riegel, vdot, zoneDistribution,
  aerobicEfficiency, paceHistory, totals, metricSeries, runsOnly,
  fitnessSeries, monotony, driftSeries, monthlyVdot, compare30d, monthlyRecap,
  readinessToday, gearStats, tops, insights,
} from '../analytics.js';
import { makeChart, PALETTE, paceAxis, paceTooltip, weekLabel, scatterInteraction } from '../charts.js';
import * as A from '../analysis-text.js';

const TABS = [
  { id: 'perf', label: '⚡ Performance' },
  { id: 'load', label: '📊 Charge' },
  { id: 'health', label: '🫀 Santé' },
  { id: 'tech', label: '🦶 Technique' },
  { id: 'records', label: '🏅 Records' },
];

export function renderStats(root, ctx) {
  const tab = ctx.params?.tab || 'perf';
  root.append(el('div', { class: 'subtabs' },
    ...TABS.map(t => el('button', {
      class: `chip ${tab === t.id ? 'chip-on' : ''}`,
      onclick: () => ctx.navigate('stats', { tab: t.id }),
    }, t.label))));

  if (!runsOnly(ctx.activities).length) {
    root.append(el('div', { class: 'card muted' }, 'Pas encore de données de course. Importe tes activités dans Réglages.'));
    return;
  }

  ({ perf: renderPerf, load: renderLoad, health: renderHealth, tech: renderTech, records: renderRecords }[tab] || renderPerf)(root, ctx);
}

function cmpCell(label, value, deltaNode) {
  return el('div', { class: 'dstat' },
    el('div', { class: 'dstat-val' }, value, deltaNode || ''),
    el('div', { class: 'dstat-label' }, label));
}

function topRow(icon, label, value, date, onclick = null) {
  return el('div', { class: `top-row ${onclick ? 'clickable' : ''}`, onclick },
    el('span', { class: 'top-icon' }, icon),
    el('div', { class: 'top-main' },
      el('div', { class: 'top-label' }, label),
      el('div', { class: 'top-value' }, value)),
    el('span', { class: 'muted small' }, fmtDate(date, { day: 'numeric', month: 'short', year: '2-digit' })));
}

function analysisEl(a) {
  if (!a) return null;
  return el('div', { class: `analysis analysis-${a.tone}` },
    el('span', { class: 'analysis-icon' }, a.tone === 'good' ? '✅' : a.tone === 'warn' ? '⚠️' : '💡'),
    el('span', {}, a.text));
}

// analysis : { tone, text } affiché en conclusion sous le graphique (ou null).
function chartCard(root, id, title, subtitle = null, tall = false, analysis = null) {
  const card = el('div', { class: 'card' },
    el('div', { class: 'card-title' }, title),
    subtitle ? el('div', { class: 'muted small', style: 'margin-bottom:6px' }, subtitle) : null,
    el('div', { class: `chart-wrap ${tall ? 'tall' : ''}` }, el('canvas', { id })),
  );
  if (analysis) card.append(analysisEl(analysis));
  root.append(card);
  return document.getElementById(id);
}

// ---------- PERFORMANCE ----------

function renderPerf(root, ctx) {
  const { activities, metrics } = ctx;

  // Comparatif 30 j vs 30 j précédents
  const cmp = compare30d(activities);
  if (cmp.current.count || cmp.previous.count) {
    const delta = (cur, prev, invert = false, fmt = v => v) => {
      if (cur == null || prev == null || !prev) return null;
      const diff = cur - prev;
      const better = invert ? diff < 0 : diff > 0;
      const sign = diff > 0 ? '+' : '';
      return el('span', { class: `delta ${Math.abs(diff) < 0.005 * Math.abs(prev) ? '' : better ? 'delta-good' : 'delta-bad'}` },
        `${sign}${fmt(diff)}`);
    };
    root.append(el('div', { class: 'card' },
      el('div', { class: 'card-title' }, '⚖️ 30 derniers jours vs 30 précédents'),
      el('div', { class: 'cmp-grid' },
        cmpCell('Volume', `${cmp.current.km} km`, delta(cmp.current.km, cmp.previous.km, false, v => v.toFixed(0) + ' km')),
        cmpCell('Sorties', String(cmp.current.count), delta(cmp.current.count, cmp.previous.count, false, v => v.toFixed(0))),
        cmpCell('Allure moy.', fmtPace(cmp.current.pace), delta(cmp.current.pace, cmp.previous.pace, true, v => Math.round(Math.abs(v)) + ' s/km')),
        cmpCell('FC moy.', cmp.current.hr ? `${Math.round(cmp.current.hr)} bpm` : '–', delta(cmp.current.hr, cmp.previous.hr, true, v => Math.round(v) + ' bpm')),
        cmpCell('Cadence', cmp.current.cadence ? `${Math.round(cmp.current.cadence)}` : '–', delta(cmp.current.cadence, cmp.previous.cadence, false, v => Math.round(v))),
        cmpCell('D+', `${cmp.current.elev} m`, delta(cmp.current.elev, cmp.previous.elev, false, v => Math.round(v) + ' m')),
      ),
      analysisEl(A.analyzeCompare(cmp)),
    ));
  }

  // Allure de toutes les sorties + tendance lissée
  const hist = paceHistory(activities, 365);
  const c1 = chartCard(root, 'st-pace', '🏃 Allure par sortie (12 mois)', 'Chaque point = une sortie ; la ligne = moyenne glissante sur 7 sorties. Plus bas = plus rapide. Tiens le doigt et glisse pour lire.', true, A.analyzePace(hist));
  makeChart(c1, {
    type: 'scatter',
    data: {
      datasets: [
        {
          label: 'Sortie', data: hist.map((h, i) => ({ x: i, y: h.pace, meta: h })),
          backgroundColor: hist.map(h => h.km >= 8 ? PALETTE.blue : PALETTE.primary),
          pointRadius: hist.map(h => Math.min(3 + h.km / 3, 8)),
          pointHoverRadius: hist.map(h => Math.min(5 + h.km / 3, 10)),
        },
        {
          label: 'Tendance (7 sorties)', type: 'line',
          data: rollingMean(hist.map(h => h.pace), 7).map((v, i) => ({ x: i, y: v })),
          borderColor: PALETTE.green, pointRadius: 0, borderWidth: 2.5, tension: 0.3,
        },
      ],
    },
    options: {
      interaction: scatterInteraction,
      scales: {
        y: paceAxis(),
        x: { type: 'linear', ticks: { callback: v => hist[Math.round(v)] ? fmtDate(hist[Math.round(v)].date, { month: 'short' }) : '', maxTicksLimit: 8 } },
      },
      plugins: {
        tooltip: { callbacks: { label: c => {
          const m = c.raw.meta;
          return m ? ` ${fmtDate(m.date)} · ${m.km.toFixed(1)} km · ${fmtPace(m.pace)}${m.hr ? ' · ' + m.hr + ' bpm' : ''}` : ` ${fmtPace(c.parsed.y)}`;
        } } },
      },
    },
  });

  // VO2max
  const vo2 = metricSeries(metrics, 'vo2_max', 540);
  if (vo2.length > 2) {
    const c2 = chartCard(root, 'st-vo2', '🫁 VO₂max estimée (Apple Watch)', 'Objectif sub-50 ≈ 52–54. Ta base de départ plan : 53,8.', false, A.analyzeVo2(vo2));
    makeChart(c2, {
      type: 'line',
      data: {
        labels: vo2.map(m => fmtDate(m.date, { day: 'numeric', month: 'short' })),
        datasets: [{ label: 'VO₂max', data: vo2.map(m => m.qty), borderColor: PALETTE.purple, backgroundColor: 'rgba(114,9,183,.1)', fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2.5 }],
      },
      options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { maxTicksLimit: 7 } } } },
    });
  }

  // Efficacité aérobie
  const eff = aerobicEfficiency(activities, ctx.settings.fcMax || 195);
  if (eff.length > 4) {
    const c3 = chartCard(root, 'st-eff', '🔋 Efficacité aérobie (footings faciles)',
      'Mètres parcourus par minute et par battement, sur les sorties < 78 % FCmax. En hausse = ton moteur aérobie progresse.', false, A.analyzeEfficiency(eff));
    makeChart(c3, {
      type: 'line',
      data: {
        labels: eff.map(e => fmtDate(e.date, { day: 'numeric', month: 'short' })),
        datasets: [
          { label: 'Indice', data: eff.map(e => e.ei), borderColor: PALETTE.green, pointRadius: 2, borderWidth: 1.5, tension: 0.3 },
          { label: 'Tendance', data: rollingMean(eff.map(e => e.ei), 5), borderColor: PALETTE.blue, pointRadius: 0, borderWidth: 2.5, tension: 0.3 },
        ],
      },
      options: { scales: { x: { ticks: { maxTicksLimit: 7 } } } },
    });
  }

  // Dérive cardiaque (découplage)
  const drifts = driftSeries(activities, ctx.settings.fcMax || 195);
  if (drifts.length >= 4) {
    const c4 = chartCard(root, 'st-drift', '🫀 Dérive cardiaque (découplage)',
      'FC de la 2e moitié vs 1re moitié sur les sorties régulières ≥ 25 min. < 5 % (zone verte) = base aérobie solide : tu tiendras l’allure sur la durée.', false, A.analyzeDrift(drifts));
    makeChart(c4, {
      type: 'bar',
      data: {
        labels: drifts.map(d => fmtDate(d.date, { day: 'numeric', month: 'short' })),
        datasets: [{
          label: 'dérive %', data: drifts.map(d => d.drift),
          backgroundColor: drifts.map(d => d.drift < 5 ? PALETTE.green : d.drift < 9 ? PALETTE.yellow : PALETTE.pink),
          borderRadius: 4,
        }],
      },
      options: {
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.parsed.y} % · ${drifts[c.dataIndex].km.toFixed(1)} km · ${drifts[c.dataIndex].name}` } } },
        scales: { y: { title: { display: true, text: '%' } }, x: { ticks: { maxTicksLimit: 8 } } },
      },
    });
  }

  // VDOT mensuel
  const mv = monthlyVdot(activities);
  if (mv.filter(m => m.v).length >= 3) {
    const c5 = chartCard(root, 'st-vdot', '📐 VDOT mensuel (meilleure perf du mois)',
      'Indice de forme de Daniels calculé sur ta meilleure sortie ≥ 3 km de chaque mois. Sub-50 au 10 km ≈ VDOT 40.', false, A.analyzeVdot(mv));
    makeChart(c5, {
      type: 'line',
      data: {
        labels: mv.map(m => m.month.slice(5) + '/' + m.month.slice(2, 4)),
        datasets: [{
          label: 'VDOT', data: mv.map(m => m.v), borderColor: PALETTE.primary,
          backgroundColor: 'rgba(255,107,53,.1)', fill: true, tension: 0.3, spanGaps: true,
          pointRadius: 4, pointBackgroundColor: PALETTE.primary,
        }],
      },
      options: {
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => {
          const m = mv[c.dataIndex];
          return m.a ? ` VDOT ${m.v} — ${(m.a.distance / 1000).toFixed(1)} km en ${fmtDuration(m.a.movingTime)}` : '';
        } } } },
      },
    });
  }

  // Projection 10k
  const pred = predict10k(activities);
  if (pred) {
    const target = 50 * 60;
    const delta = pred.predicted - target;
    root.append(el('div', { class: `card predict ${delta <= 0 ? 'predict-good' : ''}` },
      el('div', { class: 'card-title' }, '🔮 Projection 10 km (Riegel)'),
      el('div', { class: 'predict-time' }, fmtDurationLong(pred.predicted)),
      el('div', { class: 'muted' },
        delta <= 0 ? `🎉 ${fmtDuration(-delta)} sous l'objectif 50:00 !` : `Encore ${fmtDuration(delta)} à gagner pour le sub 50.`),
      el('div', { class: 'muted small' },
        `Basée sur : ${pred.activity.name} — ${fmtKm(pred.activity.distance)} en ${fmtDuration(pred.activity.movingTime)} (${fmtDate(pred.activity.date)}) · VDOT ${vdot(pred.activity.distance, pred.activity.movingTime)}`),
    ));
  }
}

// ---------- CHARGE ----------

function renderLoad(root, ctx) {
  const { activities } = ctx;
  const s = ctx.settings;

  // Fitness / Fatigue / Forme
  const fit = fitnessSeries(activities, 180, s.fcMax || 195, s.fcRepos || 55);
  if (fit.length > 14) {
    const last = fit.at(-1);
    const formLabel = last.tsb > 10 ? 'très frais (affûté)' : last.tsb > -5 ? 'équilibré' : last.tsb > -20 ? 'en charge (normal en bloc)' : 'très fatigué';
    root.append(el('div', { class: 'tiles tiles-3' },
      el('div', { class: 'tile' }, el('div', { class: 'tile-icon' }, '🏗️'), el('div', { class: 'tile-value' }, String(Math.round(last.ctl))), el('div', { class: 'tile-label' }, 'Fitness (CTL)')),
      el('div', { class: 'tile' }, el('div', { class: 'tile-icon' }, '🥵'), el('div', { class: 'tile-value' }, String(Math.round(last.atl))), el('div', { class: 'tile-label' }, 'Fatigue (ATL)')),
      el('div', { class: `tile ${last.tsb > -5 ? 'good' : last.tsb < -20 ? 'warn' : ''}` }, el('div', { class: 'tile-icon' }, '⚡'), el('div', { class: 'tile-value' }, (last.tsb > 0 ? '+' : '') + Math.round(last.tsb)), el('div', { class: 'tile-label' }, `Forme (TSB) — ${formLabel}`)),
    ));
    const c0 = chartCard(root, 'st-fit', '🏗️ Fitness / Fatigue / Forme (6 mois)',
      'Modèle classique : la Fitness (charge chronique 42 j) se construit lentement ; la Fatigue (7 j) monte vite et redescend vite. Forme = Fitness − Fatigue : légèrement négative en bloc d’entraînement, positive à l’affûtage → vise +5 à +15 le jour du 10 km.', true, A.analyzeForm(fit));
    makeChart(c0, {
      type: 'line',
      data: {
        labels: fit.map(f => fmtDate(f.date, { day: 'numeric', month: 'short' })),
        datasets: [
          { label: 'Fitness', data: fit.map(f => f.ctl), borderColor: PALETTE.blue, backgroundColor: 'rgba(67,97,238,.08)', fill: true, pointRadius: 0, borderWidth: 2.5, tension: 0.3 },
          { label: 'Fatigue', data: fit.map(f => f.atl), borderColor: PALETTE.pink, pointRadius: 0, borderWidth: 1.5, tension: 0.3 },
          { label: 'Forme', data: fit.map(f => f.tsb), borderColor: PALETTE.green, pointRadius: 0, borderWidth: 2, tension: 0.3 },
        ],
      },
      options: { scales: { x: { ticks: { maxTicksLimit: 7 } } } },
    });
  }

  const vol = weeklyVolume(activities, 26);
  const c1 = chartCard(root, 'st-vol', '📊 Volume & charge hebdo (26 sem.)', 'Barres = km ; ligne = charge d’entraînement (TRIMP, échelle de droite).', true, A.analyzeVolume(vol));
  makeChart(c1, {
    type: 'bar',
    data: {
      labels: vol.map(v => weekLabel(v.week)),
      datasets: [
        { label: 'km', data: vol.map(v => +v.km.toFixed(1)), backgroundColor: PALETTE.primary, borderRadius: 4, yAxisID: 'y' },
        { label: 'charge', data: vol.map(v => v.load), type: 'line', borderColor: PALETTE.purple, pointRadius: 0, borderWidth: 2, tension: 0.3, yAxisID: 'y2' },
      ],
    },
    options: {
      scales: {
        y: { beginAtZero: true, title: { display: true, text: 'km' } },
        y2: { beginAtZero: true, position: 'right', grid: { display: false } },
        x: { ticks: { maxTicksLimit: 13 } },
      },
    },
  });

  const acwr = acwrSeries(activities, 90, s.fcMax || 195, s.fcRepos || 55);
  const c2 = chartCard(root, 'st-acwr', '⚖️ Ratio charge aiguë / chronique (ACWR)',
    'Zone verte 0,8–1,3 = progression sûre. > 1,5 = risque de blessure (crucial avec tes tibias sensibles).', false, A.analyzeAcwr(acwr));
  makeChart(c2, {
    type: 'line',
    data: {
      labels: acwr.map(a => fmtDate(a.date, { day: 'numeric', month: 'short' })),
      datasets: [{
        label: 'ACWR', data: acwr.map(a => a.ratio),
        borderColor: PALETTE.blue, pointRadius: 0, borderWidth: 2.5, tension: 0.3,
        segment: { borderColor: c => { const v = c.p1.parsed.y; return v > 1.5 ? PALETTE.pink : v > 1.3 ? PALETTE.yellow : PALETTE.green; } },
      }],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: { y: { suggestedMin: 0, suggestedMax: 2 }, x: { ticks: { maxTicksLimit: 7 } } },
    },
  });

  // Monotonie de la semaine (Foster)
  const mono = monotony(activities, s.fcMax || 195, s.fcRepos || 55);
  if (mono.monotony != null) {
    const monoTone = mono.monotony < 1.5 ? 'good' : mono.monotony < 2 ? '' : 'warn';
    const monoText = mono.monotony < 1.5
      ? '✅ Bonne alternance jours durs / jours faciles.'
      : mono.monotony < 2
        ? 'Alternance correcte, garde des jours vraiment légers.'
        : '⚠️ Semaine trop monotone : même dose chaque jour = risque de blessure accru. Alterne dur et facile.';
    root.append(el('div', { class: `card small ${monoTone === 'warn' ? 'card-warn' : ''}` },
      el('b', {}, `Monotonie 7 j : ${mono.monotony}`), ` · charge ${mono.weekLoad} · contrainte ${mono.strain}. ${monoText}`));
  }

  // Récap mensuel
  const months = monthlyRecap(activities, 12);
  if (months.some(m => m.km > 0)) {
    const cM = chartCard(root, 'st-months', '📅 Kilométrage mensuel (12 mois)', 'Barres = km ; ligne = dénivelé positif cumulé (échelle de droite).', false, A.analyzeMonthlyKm(months));
    makeChart(cM, {
      type: 'bar',
      data: {
        labels: months.map(m => m.label),
        datasets: [
          { label: 'km', data: months.map(m => +m.km.toFixed(0)), backgroundColor: PALETTE.teal, borderRadius: 6, yAxisID: 'y' },
          { label: 'D+ (m)', data: months.map(m => Math.round(m.elev)), type: 'line', borderColor: PALETTE.purple, pointRadius: 2, borderWidth: 2, tension: 0.3, yAxisID: 'y2' },
        ],
      },
      options: {
        scales: {
          y: { beginAtZero: true, title: { display: true, text: 'km' } },
          y2: { beginAtZero: true, position: 'right', grid: { display: false } },
        },
        plugins: { tooltip: { callbacks: { afterLabel: c => c.datasetIndex === 0 ? `${months[c.dataIndex].count} sorties · ${Math.round(months[c.dataIndex].time / 3600)} h` : '' } } },
      },
    });
  }

  // Répartition zones FC
  const zones = zoneDistribution(activities, s.fcMax || 195, 42);
  const totalZ = zones.reduce((a, z) => a + z.seconds, 0);
  if (totalZ > 0) {
    const c3 = chartCard(root, 'st-zones', '🎨 Temps par zone FC (6 dernières semaines)',
      'Le plan vise ~80 % en Z1–Z2 (EF « vraiment lent ») et ~20 % en Z4–Z5 (qualité).', false, A.analyzeZones(zones));
    makeChart(c3, {
      type: 'bar',
      data: {
        labels: zones.map(z => z.label),
        datasets: [{ data: zones.map(z => +(z.seconds / 3600).toFixed(1)), backgroundColor: zones.map(z => z.color), borderRadius: 6 }],
      },
      options: {
        indexAxis: 'y',
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.parsed.x} h (${Math.round(zones[c.dataIndex].seconds / totalZ * 100)} %)` } } },
        scales: { x: { title: { display: true, text: 'heures' } } },
      },
    });
  }
}

// ---------- SANTÉ ----------

function renderHealth(root, ctx) {
  const { metrics } = ctx;

  // Feu du jour : prêt à s'entraîner ?
  const ready = readinessToday(ctx.activities, metrics, ctx.settings.fcMax || 195, ctx.settings.fcRepos || 55);
  if (ready) {
    const light = { green: '🟢', orange: '🟠', red: '🔴' }[ready.status];
    root.append(el('div', { class: `card readiness-card ready-${ready.status}` },
      el('div', { class: 'ready-head' },
        el('span', { class: 'ready-light' }, light),
        el('div', {},
          el('div', { class: 'card-title', style: 'margin:0' }, 'Prêt à t’entraîner aujourd’hui ?'),
          el('div', { class: 'small' }, ready.advice)),
      ),
      el('div', { class: 'ready-parts' },
        ...ready.parts.map(p => el('div', { class: 'rp-row' },
          el('span', {}, `${['🔴', '🟠', '🟢'][p.s]} ${p.label}`),
          el('span', { class: 'rp-score' }, p.value)))),
    ));
  }

  // Équilibre charge ↔ récupération (HRV vs charge hebdo glissante)
  const hrvSeries = metricSeries(metrics, 'heart_rate_variability', 90);
  if (hrvSeries.length > 10) {
    const acwr = acwrSeries(ctx.activities, 90, ctx.settings.fcMax || 195, ctx.settings.fcRepos || 55);
    const loadByDate = new Map(acwr.map(a => [a.date, a.acute]));
    const balancePoints = hrvSeries.map(m => ({ hrv: m.qty, load: loadByDate.get(m.date) ?? null })).filter(p => p.load != null);
    const cB = chartCard(root, 'st-balance', '🔀 Charge ↔ récupération (90 j)',
      'Barres = charge des 7 derniers jours ; ligne = HRV lissée. Si la charge monte et que la HRV plonge durablement, ton corps décroche : allège avant que les tibias ne parlent.', true, A.analyzeBalance(balancePoints));
    makeChart(cB, {
      type: 'bar',
      data: {
        labels: hrvSeries.map(m => fmtDate(m.date, { day: 'numeric', month: 'short' })),
        datasets: [
          { label: 'charge 7 j', data: hrvSeries.map(m => loadByDate.get(m.date) ?? null), backgroundColor: 'rgba(255,107,53,.35)', borderRadius: 3, yAxisID: 'y2' },
          { label: 'HRV (moy. 7 j)', data: rollingMean(hrvSeries.map(m => m.qty), 7).map(v => v ? +v.toFixed(1) : null), type: 'line', borderColor: PALETTE.blue, pointRadius: 0, borderWidth: 2.5, tension: 0.35, yAxisID: 'y' },
        ],
      },
      options: {
        scales: {
          y: { title: { display: true, text: 'ms' } },
          y2: { position: 'right', grid: { display: false }, beginAtZero: true },
          x: { ticks: { maxTicksLimit: 7 } },
        },
      },
    });
  }

  const specs = [
    { name: 'resting_heart_rate', id: 'st-rhr', title: '💤 FC repos', sub: 'En baisse = meilleure forme aérobie. Moyenne glissante 7 j.', color: PALETTE.pink, smooth: 7, an: A.analyzeRhr },
    { name: 'heart_rate_variability', id: 'st-hrv', title: '📶 Variabilité cardiaque (HRV)', sub: 'Élevée = bonne récupération. Chute brutale = fatigue/stress : allège.', color: PALETTE.blue, smooth: 7, an: A.analyzeHrv },
    { name: 'cardio_recovery', id: 'st-rec', title: '🔄 Récupération cardiaque (1 min)', sub: 'Baisse de FC 1 min après l’effort. > 30 bpm = très bon.', color: PALETTE.green, smooth: 5, an: A.analyzeRecovery },
    { name: 'weight_body_mass', id: 'st-weight', title: '⚖️ Poids', sub: null, color: PALETTE.gray, smooth: 7, an: A.analyzeWeight },
  ];
  let any = false;
  for (const spec of specs) {
    const data = metricSeries(metrics, spec.name, 270);
    if (data.length < 3) continue;
    any = true;
    const canvas = chartCard(root, spec.id, spec.title, spec.sub, false, spec.an ? spec.an(data) : null);
    makeChart(canvas, {
      type: 'line',
      data: {
        labels: data.map(m => fmtDate(m.date, { day: 'numeric', month: 'short' })),
        datasets: [
          { label: 'valeur', data: data.map(m => +m.qty.toFixed(1)), borderColor: spec.color + '55', pointRadius: 1.5, borderWidth: 1, tension: 0.2 },
          { label: `moy. ${spec.smooth} j`, data: rollingMean(data.map(m => m.qty), spec.smooth).map(v => v ? +v.toFixed(1) : null), borderColor: spec.color, pointRadius: 0, borderWidth: 2.5, tension: 0.35 },
        ],
      },
      options: { scales: { x: { ticks: { maxTicksLimit: 7 } } } },
    });
  }

  // Sommeil
  const sleep = metricSeries(metrics, 'sleep', 60);
  if (sleep.length > 3) {
    any = true;
    const avg = mean(sleep.map(m => m.total).filter(Boolean));
    const canvas = chartCard(root, 'st-sleep', '😴 Sommeil (60 nuits)', 'Empilé : profond + paradoxal (REM) + léger.', true, A.analyzeSleep(avg));
    makeChart(canvas, {
      type: 'bar',
      data: {
        labels: sleep.map(m => fmtDate(m.date, { day: 'numeric', month: 'short' })),
        datasets: [
          { label: 'Profond', data: sleep.map(m => m.deep), backgroundColor: PALETTE.purple, stack: 's' },
          { label: 'REM', data: sleep.map(m => m.rem), backgroundColor: PALETTE.blue, stack: 's' },
          { label: 'Léger', data: sleep.map(m => m.core), backgroundColor: '#a7c4f5', stack: 's' },
        ],
      },
      options: {
        scales: {
          x: { stacked: true, ticks: { maxTicksLimit: 8 } },
          y: { stacked: true, title: { display: true, text: 'heures' }, suggestedMax: 10 },
        },
      },
    });
  }

  if (!any) root.append(el('div', { class: 'card muted' }, 'Importe ton export Santé (Réglages) pour voir FC repos, HRV, sommeil, poids…'));
}

// ---------- TECHNIQUE ----------

function renderTech(root, ctx) {
  const { metrics } = ctx;
  const specs = [
    { name: 'running_speed', id: 'st-cadspeed', title: '🚀 Vitesse de course (Santé)', sub: null, color: PALETTE.primary, unit: 'km/h', an: A.analyzeSpeed },
    { name: 'running_stride_length', id: 'st-stride', title: '📏 Longueur de foulée', sub: 'S’allonge naturellement quand la vitesse monte — ne la force jamais.', color: PALETTE.blue, unit: 'm', an: A.analyzeStride },
    { name: 'running_power', id: 'st-power', title: '⚡ Puissance', sub: null, color: PALETTE.purple, unit: 'W', an: A.analyzePower },
    { name: 'running_ground_contact_time', id: 'st-gct', title: '⏱️ Temps de contact au sol', sub: 'En baisse = foulée plus réactive. Élite ≈ 200 ms, amateur 250–300 ms.', color: PALETTE.pink, unit: 'ms', an: A.analyzeGct },
    { name: 'running_vertical_oscillation', id: 'st-vo', title: '↕️ Oscillation verticale', sub: 'Moins tu rebondis, moins tu gaspilles (6–9 cm = très bien).', color: PALETTE.teal, unit: 'cm', an: A.analyzeVertOsc },
  ];
  let any = false;
  for (const spec of specs) {
    const data = metricSeries(metrics, spec.name, 365);
    if (data.length < 3) continue;
    any = true;
    const canvas = chartCard(root, spec.id, spec.title, spec.sub, false, spec.an ? spec.an(data) : null);
    makeChart(canvas, {
      type: 'line',
      data: {
        labels: data.map(m => fmtDate(m.date, { day: 'numeric', month: 'short' })),
        datasets: [
          { label: spec.unit, data: data.map(m => +m.qty.toFixed(2)), borderColor: spec.color + '55', pointRadius: 1.5, borderWidth: 1, tension: 0.2 },
          { label: 'tendance', data: rollingMean(data.map(m => m.qty), 7).map(v => v ? +v.toFixed(2) : null), borderColor: spec.color, pointRadius: 0, borderWidth: 2.5, tension: 0.35 },
        ],
      },
      options: { scales: { x: { ticks: { maxTicksLimit: 7 } } } },
    });
  }

  // Cadence depuis les activités
  const runs = runsOnly(ctx.activities).filter(a => a.cadence && a.cadence > 120).sort((a, b) => new Date(a.date) - new Date(b.date));
  if (runs.length > 4) {
    any = true;
    const canvas = chartCard(root, 'st-cadence', '👟 Cadence par sortie', 'Cible générale : 170–180 pas/min. Une cadence plus haute réduit l’impact sur les tibias.', false, A.analyzeCadence(mean(runs.slice(-15).map(a => a.cadence))));
    makeChart(canvas, {
      type: 'line',
      data: {
        labels: runs.map(a => fmtDate(a.date, { day: 'numeric', month: 'short' })),
        datasets: [
          { label: 'pas/min', data: runs.map(a => a.cadence), borderColor: PALETTE.primary + '55', pointRadius: 2, borderWidth: 1, tension: 0.2 },
          { label: 'tendance', data: rollingMean(runs.map(a => a.cadence), 7), borderColor: PALETTE.primary, pointRadius: 0, borderWidth: 2.5, tension: 0.35 },
        ],
      },
      options: { scales: { x: { ticks: { maxTicksLimit: 7 } } } },
    });
  }
  // Cadence vs allure : sur-foulée quand ça accélère ?
  const cadPace = runsOnly(ctx.activities)
    .filter(a => a.cadence > 120 && a.distance >= 2000)
    .map(a => ({ pace: paceOf(a.distance, a.movingTime), cad: a.cadence, km: a.distance / 1000, date: a.date, name: a.name }))
    .filter(p => p.pace > 200 && p.pace < 600);
  if (cadPace.length >= 8) {
    any = true;
    const canvas = chartCard(root, 'st-cadpace', '🔗 Cadence vs allure',
      'Chaque point = une sortie. La cadence doit monter quand tu accélères (vers la droite = plus rapide). Si elle stagne à haute vitesse, tu allonges trop la foulée : plus d’impact tibial.', false, A.analyzeCadencePace(cadPace));
    makeChart(canvas, {
      type: 'scatter',
      data: {
        datasets: [{
          label: 'sortie',
          data: cadPace.map(p => ({ x: -p.pace, y: p.cad, meta: p })),
          backgroundColor: PALETTE.blue,
          pointRadius: cadPace.map(p => Math.min(3 + p.km / 3, 8)),
          pointHoverRadius: cadPace.map(p => Math.min(5 + p.km / 3, 10)),
        }],
      },
      options: {
        interaction: scatterInteraction,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: c => ` ${fmtDate(c.raw.meta.date)} · ${fmtPace(c.raw.meta.pace)} · ${c.raw.meta.cad} pas/min` } },
        },
        scales: {
          x: { type: 'linear', ticks: { callback: v => fmtPace(-v, '') }, title: { display: true, text: 'allure (→ plus rapide)' } },
          y: { title: { display: true, text: 'pas/min' } },
        },
      },
    });
  }

  // Économie de course : vitesse par watt
  const spd = metricSeries(ctx.metrics, 'running_speed', 365);
  const pow = metricSeries(ctx.metrics, 'running_power', 365);
  if (spd.length > 5 && pow.length > 5) {
    const powByDate = new Map(pow.map(m => [m.date, m.qty]));
    const eco = spd
      .map(m => {
        const w = powByDate.get(m.date);
        return w && w > 80 ? { date: m.date, eco: +(m.qty / 3.6 / w * 1000).toFixed(1) } : null; // m/s par kW
      })
      .filter(Boolean);
    if (eco.length > 5) {
      any = true;
      const canvas = chartCard(root, 'st-eco', '🌱 Économie de course',
        'Vitesse produite par watt de puissance (jours de course). En hausse = tu transformes mieux ton énergie en vitesse : foulée plus économique.', false, A.analyzeEconomy(eco));
      makeChart(canvas, {
        type: 'line',
        data: {
          labels: eco.map(m => fmtDate(m.date, { day: 'numeric', month: 'short' })),
          datasets: [
            { label: 'm/s par kW', data: eco.map(m => m.eco), borderColor: PALETTE.green + '55', pointRadius: 1.5, borderWidth: 1, tension: 0.2 },
            { label: 'tendance', data: rollingMean(eco.map(m => m.eco), 7).map(v => v ? +v.toFixed(1) : null), borderColor: PALETTE.green, pointRadius: 0, borderWidth: 2.5, tension: 0.35 },
          ],
        },
        options: { scales: { x: { ticks: { maxTicksLimit: 7 } } } },
      });
    }
  }

  if (!any) root.append(el('div', { class: 'card muted' }, 'Importe ton export Santé pour les données de technique de course.'));
}

// ---------- RECORDS ----------

function renderRecords(root, ctx) {
  const recs = records(ctx.activities);
  const tot = totals(ctx.activities);

  // Insights automatiques
  const ins = insights(ctx.activities, ctx.metrics, ctx.settings.fcMax || 195);
  if (ins.length) {
    root.append(el('div', { class: 'card' },
      el('div', { class: 'card-title' }, '🧠 Ce que disent tes données'),
      ...ins.map(i => el('div', { class: `insight insight-${i.tone}` },
        el('span', { class: 'insight-icon' }, i.icon),
        el('span', {}, i.text))),
    ));
  }

  root.append(el('div', { class: 'tiles' },
    el('div', { class: 'tile' }, el('div', { class: 'tile-icon' }, '🌍'), el('div', { class: 'tile-value' }, fmtKm(tot.allKm * 1000, 0)), el('div', { class: 'tile-label' }, `depuis ${fmtDate(tot.firstDate, { month: 'short', year: 'numeric' })}`)),
    el('div', { class: 'tile' }, el('div', { class: 'tile-icon' }, '🏃'), el('div', { class: 'tile-value' }, String(tot.allCount)), el('div', { class: 'tile-label' }, 'sorties')),
    el('div', { class: 'tile' }, el('div', { class: 'tile-icon' }, '⏳'), el('div', { class: 'tile-value' }, Math.round(tot.allHours) + ' h'), el('div', { class: 'tile-label' }, 'de course')),
    el('div', { class: 'tile' }, el('div', { class: 'tile-icon' }, '📅'), el('div', { class: 'tile-value' }, fmtKm(tot.yearKm * 1000, 0)), el('div', { class: 'tile-label' }, `en ${new Date().getFullYear()}`)),
  ));

  const card = el('div', { class: 'card' }, el('div', { class: 'card-title' }, '🏅 Meilleures allures par distance'));
  for (const r of recs) {
    if (!r.best) continue;
    const bestPace = paceOf(r.best.distance, r.best.movingTime);
    const recentPace = r.recent ? paceOf(r.recent.distance, r.recent.movingTime) : null;
    const isRecentBest = r.recent && r.recent.id === r.best.id;
    card.append(el('div', { class: 'record-row', onclick: () => ctx.navigate('activities', { activityId: r.best.id }) },
      el('div', { class: 'record-bucket' }, r.label),
      el('div', { class: 'record-main' },
        el('div', { class: 'record-pace' }, fmtPace(bestPace), isRecentBest ? el('span', { class: 'suggest-chip' }, ' 🔥 récent !') : null),
        el('div', { class: 'muted small' }, `${r.best.name} · ${fmtKm(r.best.distance)} en ${fmtDuration(r.best.movingTime)} · ${fmtDate(r.best.date, { day: 'numeric', month: 'short', year: 'numeric' })}`),
        recentPace && !isRecentBest ? el('div', { class: 'muted small' }, `Meilleur 60 j : ${fmtPace(recentPace)} (écart ${fmtPace(recentPace - bestPace, '')})`) : null,
      ),
      el('div', { class: 'record-count muted small' }, `${r.count}×`),
    ));
  }
  root.append(card);

  // Courbe des records : meilleure allure tenue par distance
  const withBest = recs.filter(r => r.best);
  if (withBest.length >= 3) {
    let recAnalysis = null;
    const b35 = withBest.find(r => r.key === '3k+'), b812 = withBest.find(r => r.key === '8k+');
    if (b35 && b812) {
      const gap = paceOf(b812.best.distance, b812.best.movingTime) - paceOf(b35.best.distance, b35.best.movingTime);
      if (gap < 25) recAnalysis = A.box('good', `Courbe très plate (${Math.round(gap)} s/km entre 3–5 km et 8–12 km) : excellente endurance, ton allure 10 km est proche de ta vitesse pure. Le sub-50 se joue surtout sur la gestion de départ et le mental.`);
      else if (gap < 55) recAnalysis = A.box('info', `Écart de ${Math.round(gap)} s/km entre le court et le long : normal. Le seuil et les sorties longues le resserreront encore.`);
      else recAnalysis = A.box('warn', `Gros écart (${Math.round(gap)} s/km) entre ta vitesse courte et ton allure longue : c'est l'endurance qui te limite, pas la vitesse pure. Priorise le volume lent et les sorties longues.`);
    }
    const cR = chartCard(root, 'st-reccurve', '📉 Courbe des records',
      'Ta meilleure allure tenue selon la distance. Plus la courbe est plate, plus ton endurance est bonne ; l’écart entre 3–5 km et 8–12 km montre ta marge sur 10 km.', false, recAnalysis);
    makeChart(cR, {
      type: 'line',
      data: {
        labels: withBest.map(r => r.label),
        datasets: [
          { label: 'record', data: withBest.map(r => +paceOf(r.best.distance, r.best.movingTime).toFixed(0)), borderColor: PALETTE.purple, backgroundColor: 'rgba(114,9,183,.1)', fill: true, tension: 0.25, pointRadius: 5, pointBackgroundColor: PALETTE.purple },
          { label: 'meilleur 60 j', data: withBest.map(r => r.recent ? +paceOf(r.recent.distance, r.recent.movingTime).toFixed(0) : null), borderColor: PALETTE.primary, borderDash: [6, 4], tension: 0.25, pointRadius: 4 },
        ],
      },
      options: { scales: { y: paceAxis() }, plugins: { tooltip: paceTooltip } },
    });
  }

  // Grands moments
  const t = tops(ctx.activities);
  if (t) {
    root.append(el('div', { class: 'card' },
      el('div', { class: 'card-title' }, '🌟 Grands moments'),
      el('div', { class: 'tops' },
        topRow('🦌', 'Plus longue sortie', `${fmtKm(t.longest.distance)} · ${fmtDuration(t.longest.movingTime)}`, t.longest.date, () => ctx.navigate('activities', { activityId: t.longest.id })),
        topRow('⏳', 'Plus longue durée', `${fmtDuration(t.longestTime.movingTime)} · ${fmtKm(t.longestTime.distance)}`, t.longestTime.date, () => ctx.navigate('activities', { activityId: t.longestTime.id })),
        t.mostElev ? topRow('⛰️', 'Plus de dénivelé', `${Math.round(t.mostElev.elevGain)} m D+ · ${fmtKm(t.mostElev.distance)}`, t.mostElev.date, () => ctx.navigate('activities', { activityId: t.mostElev.id })) : null,
        t.bestWeek ? topRow('📅', 'Plus grosse semaine', `${t.bestWeek.km.toFixed(0)} km en ${t.bestWeek.count} sorties`, t.bestWeek.week) : null,
        t.bestWeekCount ? topRow('🔁', 'Semaine la plus assidue', `${t.bestWeekCount.count} sorties · ${t.bestWeekCount.km.toFixed(0)} km`, t.bestWeekCount.week) : null,
        t.bestMonth ? topRow('🗓️', 'Plus gros mois', `${t.bestMonth.km.toFixed(0)} km en ${t.bestMonth.count} sorties`, t.bestMonth.month + '-01') : null,
      ),
    ));
  }

  // Chaussures
  const gear = gearStats(ctx.activities);
  if (gear.length) {
    root.append(el('div', { class: 'card' },
      el('div', { class: 'card-title' }, '👟 Chaussures'),
      el('div', { class: 'muted small', style: 'margin-bottom:8px' }, 'Usure estimée sur une durée de vie de ~700 km. Au-delà, l’amorti fatigue… et les tibias le sentent.'),
      ...gear.map(g => el('div', { class: 'gear-row' },
        el('div', { class: 'gear-info' },
          el('div', { class: 'gear-name' }, g.name),
          el('div', { class: 'muted small' }, `${g.km} km · ${g.count} sorties · dernière : ${fmtDate(g.last)}`)),
        el('div', { class: 'gear-bar' },
          el('div', { class: `gear-fill ${g.wear > 0.85 ? 'gear-worn' : ''}`, style: `width:${Math.round(g.wear * 100)}%` })),
        el('span', { class: `small ${g.wear > 0.85 ? 'gear-alert' : 'muted'}` }, `${Math.round(g.wear * 100)} %${g.wear >= 1 ? ' ⚠️' : ''}`),
      )),
    ));
  }

  // Équivalences Riegel depuis le meilleur effort récent
  const pred = predict10k(ctx.activities);
  if (pred) {
    const base = pred.activity;
    const eq = el('div', { class: 'card' },
      el('div', { class: 'card-title' }, '🧮 Temps équivalents (Riegel)'),
      el('div', { class: 'muted small' }, `Depuis ta meilleure perf récente : ${fmtKm(base.distance)} en ${fmtDuration(base.movingTime)}`),
      el('div', { class: 'eq-grid' },
        ...[[5000, '5 km'], [10000, '10 km'], [21097, 'Semi'], [42195, 'Marathon']].map(([d, label]) => {
          const t = riegel(base.movingTime, base.distance, d);
          return el('div', { class: 'dstat' },
            el('div', { class: 'dstat-val' }, fmtDuration(t)),
            el('div', { class: 'dstat-label' }, `${label} · ${fmtPace(t / (d / 1000))}`));
        })),
    );
    root.append(eq);
  }
}
