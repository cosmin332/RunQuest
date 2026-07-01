// ============================================================
// RunQuest — Vue Dashboard : aujourd'hui, forme, semaine en cours
// ============================================================

import { el, fmtKm, fmtPace, fmtDuration, fmtDate, mean, isoDay, addDays } from '../utils.js';
import { weeklyVolume, predict10k, readinessSub50, totals, acwrSeries, metricSeries, runsOnly } from '../analytics.js';
import { programStats, sessionDate, levelFor, computeXp, weeklyStreak, allSessions } from '../gamification.js';
import { SESSION_TYPES } from '../program-data.js';
import { makeChart, PALETTE, weekLabel } from '../charts.js';

export function renderDashboard(root, ctx) {
  const { activities, metrics, programs } = ctx;
  const active = programs.find(p => !p.archived) || null;
  const stats = active ? programStats(active) : null;
  const xp = computeXp(programs);
  const level = levelFor(xp);
  const streak = weeklyStreak(programs);
  const tot = totals(activities);
  const pred = predict10k(activities);
  const vo2 = metricSeries(metrics, 'vo2_max', 999);
  const readiness = readinessSub50(activities, stats, vo2);

  // --- Héro : niveau + readiness ---
  const hero = el('div', { class: 'hero card' },
    el('div', { class: 'hero-level' },
      el('div', { class: 'level-icon' }, level.icon),
      el('div', {},
        el('div', { class: 'level-name' }, `Niv. ${level.lvl} — ${level.name}`),
        el('div', { class: 'xp-bar' }, el('div', { class: 'xp-fill', style: `width:${Math.round(level.progress * 100)}%` })),
        el('div', { class: 'xp-label' }, level.next ? `${xp} XP · ${level.next.xp - xp} XP avant « ${level.next.name} »` : `${xp} XP · niveau max !`),
      ),
      streak > 0 ? el('div', { class: 'streak-chip', title: 'Semaines consécutives avec 2+ séances' }, `🔥 ${streak}`) : null,
    ),
    el('div', { class: 'readiness' },
      gauge(readiness.total),
      el('div', { class: 'readiness-parts' },
        el('div', { class: 'readiness-title' }, 'Préparation SUB 50'),
        ...readiness.parts.map(p => el('div', { class: 'rp-row' },
          el('span', {}, p.label),
          el('span', { class: 'rp-score' }, `${p.score}/${p.max}`),
        )),
      ),
    ),
  );

  // --- Prochaine séance ---
  let nextCard = null;
  if (active && stats) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const upcoming = active.weeks
      .flatMap(w => w.sessions.map(s => ({ s, w, date: sessionDate(active, w, s) })))
      .filter(x => !x.s.completed && x.date >= addDays(today, -1))
      .sort((a, b) => a.date - b.date)[0];
    const late = active.weeks
      .flatMap(w => w.sessions.map(s => ({ s, w, date: sessionDate(active, w, s) })))
      .filter(x => !x.s.completed && !x.s.optional && x.date < today);
    nextCard = el('div', { class: 'card next-session' },
      el('div', { class: 'card-title' }, '🎯 Prochaine séance'),
      upcoming
        ? el('div', { class: 'ns-body', onclick: () => ctx.navigate('program', { week: upcoming.w.num }) },
            el('span', { class: 'type-pill', style: `background:${SESSION_TYPES[upcoming.s.type].color}` }, SESSION_TYPES[upcoming.s.type].label),
            el('div', {},
              el('div', { class: 'ns-title' }, upcoming.s.title),
              el('div', { class: 'ns-meta' }, `${fmtDate(upcoming.date)} · S${upcoming.w.num} · ${upcoming.s.estKm ? `~${upcoming.s.estKm} km · ` : ''}${upcoming.s.estMin ? `~${upcoming.s.estMin} min` : ''}`),
            ),
            el('span', { class: 'chevron' }, '›'),
          )
        : el('div', { class: 'muted' }, 'Programme terminé 🎉'),
      late.length ? el('div', { class: 'late-note' }, `⚠️ ${late.length} séance${late.length > 1 ? 's' : ''} en retard — pense à les valider ou les rattraper`) : null,
      el('div', { class: 'prog-mini' },
        el('div', { class: 'prog-mini-bar' }, el('div', { style: `width:${Math.round(stats.completion * 100)}%` })),
        el('span', {}, `${stats.completed}/${stats.total} séances · ` + (stats.currentWeekNum < 1
          ? `départ ${fmtDate(active.startDate)}`
          : stats.currentWeekNum > active.weeks.length
            ? 'programme terminé'
            : `semaine ${stats.currentWeekNum}/${active.weeks.length}`)),
      ),
    );
  } else {
    nextCard = el('div', { class: 'card' },
      el('div', { class: 'card-title' }, '🎯 Programme'),
      el('div', { class: 'muted' }, 'Aucun programme actif. Va dans l’onglet Programme.'),
    );
  }

  // --- Tuiles chiffres clés ---
  const last7 = runsOnly(activities).filter(a => new Date(a.date) > addDays(new Date(), -7));
  const kmWeek = last7.reduce((s, a) => s + a.distance, 0) / 1000;
  const rhr = metricSeries(metrics, 'resting_heart_rate', 14);
  const acwr = acwrSeries(activities, 7).at(-1);
  const tiles = el('div', { class: 'tiles' },
    tile('👟', fmtKm(kmWeek * 1000, 1), '7 derniers jours'),
    tile('📈', fmtKm(tot.last30Km * 1000, 0), '30 derniers jours'),
    tile('⏱️', pred ? fmtDuration(pred.predicted) : '–', '10 km projeté', pred && pred.predicted <= 3000 ? 'good' : ''),
    tile('🫀', vo2.length ? vo2.at(-1).qty.toFixed(1) : '–', 'VO₂max'),
    tile('😴', rhr.length ? Math.round(mean(rhr.map(m => m.qty))) : '–', 'FC repos (14 j)'),
    tile('⚖️', acwr?.ratio != null ? acwr.ratio.toFixed(2) : '–', 'Charge ACWR', acwr?.ratio > 1.4 ? 'warn' : acwr?.ratio >= 0.8 && acwr?.ratio <= 1.3 ? 'good' : ''),
  );

  // --- Graphique volume 12 semaines + cible programme ---
  const vol = weeklyVolume(activities, 12);
  const volCard = el('div', { class: 'card' },
    el('div', { class: 'card-title' }, '📊 Volume hebdomadaire (12 sem.)'),
    el('div', { class: 'chart-wrap' }, el('canvas', { id: 'dash-vol' })),
  );

  root.append(hero, nextCard, tiles, volCard);

  const targetByWeek = new Map();
  if (active) {
    for (const w of active.weeks) {
      const monday = isoDay(addDays(new Date(active.startDate + 'T12:00:00'), (w.num - 1) * 7));
      targetByWeek.set(monday, w.targetKm);
    }
  }
  makeChart(document.getElementById('dash-vol'), {
    type: 'bar',
    data: {
      labels: vol.map(v => weekLabel(v.week)),
      datasets: [
        { label: 'km courus', data: vol.map(v => +v.km.toFixed(1)), backgroundColor: PALETTE.primary, borderRadius: 6 },
        { label: 'cible plan', data: vol.map(v => targetByWeek.get(v.week) ?? null), type: 'line', borderColor: PALETTE.blue, borderDash: [6, 4], pointRadius: 3, tension: 0 },
      ],
    },
    options: { scales: { y: { beginAtZero: true, title: { display: true, text: 'km' } } } },
  });
}

function tile(icon, value, label, tone = '') {
  return el('div', { class: `tile ${tone}` },
    el('div', { class: 'tile-icon' }, icon),
    el('div', { class: 'tile-value' }, value),
    el('div', { class: 'tile-label' }, label),
  );
}

function gauge(score) {
  const angle = Math.round(score * 3.6);
  const color = score >= 70 ? PALETTE.green : score >= 45 ? PALETTE.yellow : PALETTE.primary;
  return el('div', {
    class: 'gauge',
    style: `background:conic-gradient(${color} ${angle}deg, #eef1f6 ${angle}deg)`,
  }, el('div', { class: 'gauge-inner' }, el('span', { class: 'gauge-val' }, String(score)), el('span', { class: 'gauge-max' }, '/100')));
}
