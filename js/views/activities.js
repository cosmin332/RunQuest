// ============================================================
// RunQuest — Vue Activités : liste filtrable + fiche détaillée
// ============================================================

import { el, fmtKm, fmtPace, fmtDuration, fmtDate, fmtDateFull, paceOf } from '../utils.js';
import { makeChart, PALETTE } from '../charts.js';
import { hrZones } from '../analytics.js';

const SPORT_LABELS = { run: '🏃 Course', walk: '🚶 Marche', ride: '🚴 Vélo', hike: '🥾 Rando', swim: '🏊 Natation', strength: '🏋️ Renfo', workout: '💪 Training', other: '❔ Autre' };
const SOURCE_LABELS = { 'strava-api': 'Strava API', 'strava-archive': 'Archive Strava', 'health': 'Santé', 'gpx': 'GPX' };

export function renderActivities(root, ctx) {
  const detail = ctx.params?.activityId ? ctx.activities.find(a => a.id === ctx.params.activityId) : null;
  if (detail) return renderDetail(root, detail, ctx);

  let sportFilter = ctx.params?.sport || 'run';
  let shown = 30;

  const header = el('div', { class: 'act-filters' },
    ...['run', 'all', 'walk', 'ride', 'other'].map(s =>
      el('button', {
        class: `chip ${sportFilter === s ? 'chip-on' : ''}`,
        onclick: () => ctx.navigate('activities', { sport: s }),
      }, s === 'all' ? 'Tout' : SPORT_LABELS[s] || s)),
  );
  root.append(header);

  const filtered = ctx.activities.filter(a =>
    sportFilter === 'all' ? true : sportFilter === 'other' ? !['run', 'walk', 'ride'].includes(a.sport) : a.sport === sportFilter);

  if (!filtered.length) {
    root.append(el('div', { class: 'card muted' }, 'Aucune activité. Importe tes données dans Réglages.'));
    return;
  }

  const linkedIds = new Set(ctx.programs.flatMap(p => p.weeks.flatMap(w => w.sessions.map(s => s.activityId))).filter(Boolean));

  const list = el('div', { class: 'act-list' });
  const renderChunk = () => {
    list.replaceChildren();
    let lastMonth = null;
    for (const a of filtered.slice(0, shown)) {
      const month = new Date(a.date).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
      if (month !== lastMonth) {
        lastMonth = month;
        const monthActs = filtered.filter(x => new Date(x.date).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) === month && x.sport === 'run');
        const monthKm = monthActs.reduce((s, x) => s + (x.distance || 0), 0) / 1000;
        list.append(el('div', { class: 'month-sep' }, el('span', {}, month), monthKm ? el('span', { class: 'muted small' }, `${monthKm.toFixed(0)} km course`) : null));
      }
      const pace = paceOf(a.distance, a.movingTime);
      list.append(el('div', { class: 'act-row', onclick: () => ctx.navigate('activities', { activityId: a.id, sport: sportFilter }) },
        el('div', { class: 'act-ico' }, (SPORT_LABELS[a.sport] || '❔').split(' ')[0]),
        el('div', { class: 'act-main' },
          el('div', { class: 'act-name' }, a.name, linkedIds.has(a.id) ? el('span', { class: 'linked-dot', title: 'Liée à une séance du programme' }, ' 🔗') : null),
          el('div', { class: 'muted small' }, `${fmtDate(a.date)} · ${SOURCE_LABELS[a.source] || a.source}${(a.mergedSources || []).length > 1 ? ' +' : ''}`),
        ),
        el('div', { class: 'act-stats' },
          el('div', { class: 'act-km' }, fmtKm(a.distance)),
          el('div', { class: 'muted small' }, `${fmtDuration(a.movingTime)}${pace ? ' · ' + fmtPace(pace) : ''}`),
        ),
        el('span', { class: 'chevron' }, '›'),
      ));
    }
    if (filtered.length > shown) {
      list.append(el('button', { class: 'btn btn-ghost full', onclick: () => { shown += 50; renderChunk(); } },
        `Afficher plus (${filtered.length - shown} restantes)`));
    }
  };
  renderChunk();
  root.append(list);
}

function renderDetail(root, a, ctx) {
  const pace = paceOf(a.distance, a.movingTime);
  const linkedSession = ctx.programs.flatMap(p => p.weeks.flatMap(w => w.sessions.map(s => ({ s, p, w }))))
    .find(x => x.s.activityId === a.id);

  root.append(
    el('button', { class: 'btn btn-ghost', onclick: () => ctx.navigate('activities', { sport: ctx.params?.sport || 'run' }) }, '‹ Retour'),
    el('div', { class: 'card' },
      el('h2', {}, `${(SPORT_LABELS[a.sport] || '❔').split(' ')[0]} ${a.name}`),
      el('div', { class: 'muted' }, fmtDateFull(a.date) + ' · ' + new Date(a.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })),
      el('div', { class: 'muted small' }, `Source : ${(a.mergedSources || [a.source]).map(s => SOURCE_LABELS[s] || s).join(' + ')}${a.gear ? ` · 👟 ${a.gear}` : ''}`),
      linkedSession ? el('div', { class: 'linked-chip block', onclick: () => ctx.navigate('program', { programId: linkedSession.p.id }) },
        `🔗 Séance validée : ${linkedSession.s.title} (S${linkedSession.w.num} — ${linkedSession.p.name})`) : null,
      el('div', { class: 'detail-grid' },
        stat('Distance', fmtKm(a.distance)),
        stat('Durée', fmtDuration(a.movingTime)),
        stat('Allure', pace ? fmtPace(pace) : '–'),
        stat('FC moy', a.avgHr ? `${a.avgHr} bpm` : '–'),
        stat('FC max', a.maxHr ? `${a.maxHr} bpm` : '–'),
        stat('Cadence', a.cadence ? `${a.cadence} pas/min` : '–'),
        stat('D+', a.elevGain != null ? `${Math.round(a.elevGain)} m` : '–'),
        stat('Calories', a.calories ? `${a.calories} kcal` : '–'),
        stat('Effort relatif', a.effort ?? '–'),
      ),
    ),
  );

  if (a.hrSeries && a.hrSeries.length > 3) {
    root.append(el('div', { class: 'card' },
      el('div', { class: 'card-title' }, '🫀 Fréquence cardiaque'),
      el('div', { class: 'chart-wrap' }, el('canvas', { id: 'act-hr' })),
    ));
    const settings = ctx.settings;
    const zones = hrZones(settings.fcMax || 195);
    makeChart(document.getElementById('act-hr'), {
      type: 'line',
      data: {
        labels: a.hrSeries.map(([t]) => Math.round(t) + "'"),
        datasets: [{
          label: 'bpm', data: a.hrSeries.map(([, bpm]) => bpm),
          borderColor: PALETTE.pink, backgroundColor: 'rgba(238,66,102,.12)',
          fill: true, tension: 0.3, pointRadius: 0, borderWidth: 2,
        }],
      },
      options: {
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.parsed.y} bpm (${zones.find(z => c.parsed.y >= z.lo && c.parsed.y < z.hi)?.label || ''})` } } },
        scales: { y: { suggestedMin: Math.min(...a.hrSeries.map(x => x[1])) - 10 } },
      },
    });
  }
}

function stat(label, value) {
  return el('div', { class: 'dstat' }, el('div', { class: 'dstat-val' }, String(value)), el('div', { class: 'dstat-label' }, label));
}
