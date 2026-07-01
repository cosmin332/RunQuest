// ============================================================
// RunQuest — Vue Stats : Performance · Charge · Santé · Technique · Records
// ============================================================

import { el, fmtKm, fmtPace, fmtDuration, fmtDate, paceOf, rollingMean, mean, fmtDurationLong } from '../utils.js';
import {
  weeklyVolume, acwrSeries, records, predict10k, riegel, vdot, zoneDistribution,
  aerobicEfficiency, paceHistory, totals, metricSeries, runsOnly,
} from '../analytics.js';
import { makeChart, PALETTE, paceAxis, paceTooltip, weekLabel } from '../charts.js';

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

function chartCard(root, id, title, subtitle = null, tall = false) {
  root.append(el('div', { class: 'card' },
    el('div', { class: 'card-title' }, title),
    subtitle ? el('div', { class: 'muted small', style: 'margin-bottom:6px' }, subtitle) : null,
    el('div', { class: `chart-wrap ${tall ? 'tall' : ''}` }, el('canvas', { id })),
  ));
  return document.getElementById(id);
}

// ---------- PERFORMANCE ----------

function renderPerf(root, ctx) {
  const { activities, metrics } = ctx;

  // Allure de toutes les sorties + tendance lissée
  const hist = paceHistory(activities, 365);
  const c1 = chartCard(root, 'st-pace', '🏃 Allure par sortie (12 mois)', 'Chaque point = une sortie ; la ligne = moyenne glissante sur 7 sorties. Plus bas = plus rapide.', true);
  makeChart(c1, {
    type: 'scatter',
    data: {
      datasets: [
        {
          label: 'Sortie', data: hist.map((h, i) => ({ x: i, y: h.pace, meta: h })),
          backgroundColor: hist.map(h => h.km >= 8 ? PALETTE.blue : PALETTE.primary),
          pointRadius: hist.map(h => Math.min(3 + h.km / 3, 8)),
        },
        {
          label: 'Tendance (7 sorties)', type: 'line',
          data: rollingMean(hist.map(h => h.pace), 7).map((v, i) => ({ x: i, y: v })),
          borderColor: PALETTE.green, pointRadius: 0, borderWidth: 2.5, tension: 0.3,
        },
      ],
    },
    options: {
      scales: {
        y: paceAxis(),
        x: { ticks: { callback: v => hist[Math.round(v)] ? fmtDate(hist[Math.round(v)].date, { month: 'short' }) : '', maxTicksLimit: 8 } },
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
    const c2 = chartCard(root, 'st-vo2', '🫁 VO₂max estimée (Apple Watch)', 'Objectif sub-50 ≈ 52–54. Ta base de départ plan : 53,8.');
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
      'Mètres parcourus par minute et par battement, sur les sorties < 78 % FCmax. En hausse = ton moteur aérobie progresse.');
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

  const vol = weeklyVolume(activities, 26);
  const c1 = chartCard(root, 'st-vol', '📊 Volume & charge hebdo (26 sem.)', 'Barres = km ; ligne = charge d’entraînement (TRIMP, échelle de droite).', true);
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
    'Zone verte 0,8–1,3 = progression sûre. > 1,5 = risque de blessure (crucial avec tes tibias sensibles).');
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

  // Répartition zones FC
  const zones = zoneDistribution(activities, s.fcMax || 195, 42);
  const totalZ = zones.reduce((a, z) => a + z.seconds, 0);
  if (totalZ > 0) {
    const c3 = chartCard(root, 'st-zones', '🎨 Temps par zone FC (6 dernières semaines)',
      'Le plan vise ~80 % en Z1–Z2 (EF « vraiment lent ») et ~20 % en Z4–Z5 (qualité).');
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
    const easy = (zones[0].seconds + zones[1].seconds) / totalZ;
    root.append(el('div', { class: 'card small' },
      `Répartition actuelle : ${Math.round(easy * 100)} % facile (Z1–Z2) / ${Math.round((1 - easy) * 100)} % intense. `
      + (easy >= 0.75 ? '✅ Bonne polarisation, continue.' : '⚠️ Beaucoup d’intensité — ralentis tes footings EF pour protéger tes tibias.')));
  }
}

// ---------- SANTÉ ----------

function renderHealth(root, ctx) {
  const { metrics } = ctx;
  const specs = [
    { name: 'resting_heart_rate', id: 'st-rhr', title: '💤 FC repos', sub: 'En baisse = meilleure forme aérobie. Moyenne glissante 7 j.', color: PALETTE.pink, smooth: 7 },
    { name: 'heart_rate_variability', id: 'st-hrv', title: '📶 Variabilité cardiaque (HRV)', sub: 'Élevée = bonne récupération. Chute brutale = fatigue/stress : allège.', color: PALETTE.blue, smooth: 7 },
    { name: 'cardio_recovery', id: 'st-rec', title: '🔄 Récupération cardiaque (1 min)', sub: 'Baisse de FC 1 min après l’effort. > 30 bpm = très bon.', color: PALETTE.green, smooth: 5 },
    { name: 'weight_body_mass', id: 'st-weight', title: '⚖️ Poids', sub: null, color: PALETTE.gray, smooth: 7 },
  ];
  let any = false;
  for (const spec of specs) {
    const data = metricSeries(metrics, spec.name, 270);
    if (data.length < 3) continue;
    any = true;
    const canvas = chartCard(root, spec.id, spec.title, spec.sub);
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
    const canvas = chartCard(root, 'st-sleep', '😴 Sommeil (60 nuits)', 'Empilé : profond + paradoxal (REM) + léger. La ligne pointillée = 8 h.', true);
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
    const avg = mean(sleep.map(m => m.total).filter(Boolean));
    if (avg) root.append(el('div', { class: 'card small' }, `Moyenne : ${Math.floor(avg)} h ${String(Math.round((avg % 1) * 60)).padStart(2, '0')} par nuit. ${avg >= 7.5 ? '✅ Solide pour encaisser la charge.' : '⚠️ Sous 7 h 30, la récupération (et tes tibias) trinquent.'}`));
  }

  if (!any) root.append(el('div', { class: 'card muted' }, 'Importe ton export Santé (Réglages) pour voir FC repos, HRV, sommeil, poids…'));
}

// ---------- TECHNIQUE ----------

function renderTech(root, ctx) {
  const { metrics } = ctx;
  const specs = [
    { name: 'running_speed', id: 'st-cadspeed', title: '🚀 Vitesse de course (Santé)', sub: null, color: PALETTE.primary, unit: 'km/h' },
    { name: 'running_stride_length', id: 'st-stride', title: '📏 Longueur de foulée', sub: 'S’allonge naturellement quand la vitesse monte — ne la force jamais.', color: PALETTE.blue, unit: 'm' },
    { name: 'running_power', id: 'st-power', title: '⚡ Puissance', sub: null, color: PALETTE.purple, unit: 'W' },
    { name: 'running_ground_contact_time', id: 'st-gct', title: '⏱️ Temps de contact au sol', sub: 'En baisse = foulée plus réactive. Élite ≈ 200 ms, amateur 250–300 ms.', color: PALETTE.pink, unit: 'ms' },
    { name: 'running_vertical_oscillation', id: 'st-vo', title: '↕️ Oscillation verticale', sub: 'Moins tu rebondis, moins tu gaspilles (6–9 cm = très bien).', color: PALETTE.teal, unit: 'cm' },
  ];
  let any = false;
  for (const spec of specs) {
    const data = metricSeries(metrics, spec.name, 365);
    if (data.length < 3) continue;
    any = true;
    const canvas = chartCard(root, spec.id, spec.title, spec.sub);
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
    const canvas = chartCard(root, 'st-cadence', '👟 Cadence par sortie', 'Cible générale : 170–180 pas/min. Une cadence plus haute réduit l’impact sur les tibias.');
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
  if (!any) root.append(el('div', { class: 'card muted' }, 'Importe ton export Santé pour les données de technique de course.'));
}

// ---------- RECORDS ----------

function renderRecords(root, ctx) {
  const recs = records(ctx.activities);
  const tot = totals(ctx.activities);

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
