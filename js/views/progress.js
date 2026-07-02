// ============================================================
// RunQuest — Vue Progression : niveaux, badges, trophées, streak
// ============================================================

import { el, fmtDate, fmtKm, fmtDuration, fmtPace, paceOf } from '../utils.js';
import {
  LEVELS, levelFor, computeXp, BADGES, earnedBadges, weeklyStreak,
  programStats, blockGroups, weekComplete, xpTimeline, disciplineStats, weeklyQuests,
} from '../gamification.js';
import { records, tops } from '../analytics.js';
import { makeChart, PALETTE } from '../charts.js';
import { SESSION_TYPES } from '../program-data.js';

function analysisEl(a) {
  if (!a) return null;
  return el('div', { class: `analysis analysis-${a.tone}` },
    el('span', { class: 'analysis-icon' }, a.tone === 'good' ? '✅' : a.tone === 'warn' ? '⚠️' : '💡'),
    el('span', {}, a.text));
}

function trophy(icon, label, value, date, onclick = null) {
  return el('div', { class: `trophy ${onclick ? 'clickable' : ''}`, onclick },
    el('div', { class: 'trophy-icon' }, icon),
    el('div', { class: 'trophy-value' }, value),
    el('div', { class: 'trophy-label' }, label),
    el('div', { class: 'trophy-date' }, date));
}

export function renderProgress(root, ctx) {
  const xp = computeXp(ctx.programs);
  const level = levelFor(xp);
  const streak = weeklyStreak(ctx.programs);
  const earned = earnedBadges();

  // --- Niveau ---
  root.append(el('div', { class: 'card level-card' },
    el('div', { class: 'level-big' }, level.icon),
    el('h2', {}, `Niveau ${level.lvl} — ${level.name}`),
    el('div', { class: 'xp-bar big' }, el('div', { class: 'xp-fill', style: `width:${Math.round(level.progress * 100)}%` })),
    el('div', { class: 'muted' }, level.next ? `${xp} XP — plus que ${level.next.xp - xp} XP pour « ${level.next.name} » ${level.next.icon}` : `${xp} XP — niveau maximum atteint 👑`),
    streak > 0 ? el('div', { class: 'streak-big' }, `🔥 ${streak} semaine${streak > 1 ? 's' : ''} d'affilée avec 2+ séances`) : null,
  ));

  // --- Défis de la semaine ---
  const quests = weeklyQuests(ctx.programs, ctx.activities);
  const questsDone = quests.filter(q => q.done).length;
  root.append(el('div', { class: 'card' },
    el('div', { class: 'card-title' }, `⚔️ Défis de la semaine — ${questsDone}/${quests.length}`),
    ...quests.map(q => el('div', { class: `quest ${q.done ? 'quest-done' : ''}` },
      el('span', { class: 'quest-icon' }, q.done ? '✅' : q.icon),
      el('div', { class: 'quest-main' },
        el('div', { class: 'quest-label' }, q.label),
        el('div', { class: 'quest-bar' }, el('div', { style: `width:${Math.round(q.pct * 100)}%` }))),
      el('span', { class: 'quest-count' }, `${q.cur}/${q.target}`),
    )),
    questsDone === quests.length ? el('div', { class: 'quest-congrats' }, '🎉 Semaine parfaite côté défis — continue comme ça !') : null,
  ));

  // --- Courbe d'XP cumulée ---
  const timeline = xpTimeline(ctx.programs);
  if (timeline.length >= 3) {
    root.append(el('div', { class: 'card' },
      el('div', { class: 'card-title' }, '📈 Ton ascension (XP cumulée)'),
      el('div', { class: 'chart-wrap' }, el('canvas', { id: 'pg-xp' })),
    ));
    makeChart(document.getElementById('pg-xp'), {
      type: 'line',
      data: {
        labels: timeline.map(t => fmtDate(t.date, { day: 'numeric', month: 'short' })),
        datasets: [{
          label: 'XP', data: timeline.map(t => t.xp),
          borderColor: PALETTE.primary, backgroundColor: 'rgba(255,107,53,.12)',
          fill: true, stepped: true, pointRadius: 0, borderWidth: 2.5,
        }],
      },
      options: {
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: c => ` ${c.parsed.y} XP` } },
        },
        scales: { x: { ticks: { maxTicksLimit: 7 } } },
      },
    });
    // conclusion : rythme récent de gain d'XP
    const cutoff = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
    const past = timeline.filter(t => t.date < cutoff).at(-1)?.xp || 0;
    const gained = xp - past;
    root.lastChild.append(analysisEl(
      gained >= 200 ? { tone: 'good', text: `+${gained} XP sur 2 semaines : tu es à fond, ta courbe grimpe fort. Continue de valider tes séances, chaque semaine complète vaut +100 XP bonus.` }
        : gained > 0 ? { tone: 'info', text: `+${gained} XP sur 2 semaines. Valide tes séances de la semaine et tes 2 renfos pour accélérer — les semaines complètes rapportent gros.` }
        : { tone: 'warn', text: `Aucun XP gagné depuis 2 semaines. Relance-toi avec une séance facile aujourd'hui : le plus dur, c'est de repartir.` }));
    const reached = LEVELS.filter(l => l.xp > 0 && xp >= l.xp);
    if (reached.length) {
      root.lastChild.append(el('div', { class: 'muted small', style: 'margin-top:6px' },
        'Paliers franchis : ' + reached.map(l => `${l.icon} ${l.name}`).join(' · ')));
    }
  }

  // --- Échelle de niveaux ---
  root.append(el('div', { class: 'card' },
    el('div', { class: 'card-title' }, '🪜 Échelle des niveaux'),
    el('div', { class: 'level-ladder' },
      ...LEVELS.map(l => el('div', { class: `ladder-step ${xp >= l.xp ? 'reached' : ''} ${l.lvl === level.lvl ? 'current' : ''}` },
        el('span', { class: 'ladder-icon' }, l.icon),
        el('span', { class: 'ladder-name' }, `${l.lvl}. ${l.name}`),
        el('span', { class: 'ladder-xp muted small' }, `${l.xp} XP`),
      ))),
  ));

  // --- Badges ---
  const earnedCount = Object.keys(earned).length;
  root.append(el('div', { class: 'card' },
    el('div', { class: 'card-title' }, `🎖️ Badges — ${earnedCount}/${BADGES.length}`),
    el('div', { class: 'badge-grid' },
      ...BADGES.map(b => {
        const got = earned[b.id];
        return el('div', { class: `badge ${got ? 'badge-on' : 'badge-off'}`, title: b.desc },
          el('div', { class: 'badge-icon' }, b.icon),
          el('div', { class: 'badge-name' }, b.name),
          el('div', { class: 'badge-desc' }, b.desc),
          got ? el('div', { class: 'badge-date' }, fmtDate(got, { day: 'numeric', month: 'short', year: 'numeric' })) : null,
        );
      })),
  ));

  // --- Vitrine de trophées (records perso) ---
  const recs = records(ctx.activities).filter(r => r.best);
  const t = tops(ctx.activities);
  if (recs.length || t) {
    root.append(el('div', { class: 'card' },
      el('div', { class: 'card-title' }, '🏆 Vitrine de trophées'),
      el('div', { class: 'trophy-grid' },
        ...recs.map(r => trophy('⚡', `Record ${r.label}`, fmtPace(paceOf(r.best.distance, r.best.movingTime)), fmtDate(r.best.date, { month: 'short', year: '2-digit' }), () => ctx.navigate('activities', { activityId: r.best.id }))),
        t ? trophy('🦌', 'Plus longue sortie', fmtKm(t.longest.distance), fmtDate(t.longest.date, { month: 'short', year: '2-digit' }), () => ctx.navigate('activities', { activityId: t.longest.id })) : null,
        t?.bestWeek ? trophy('📅', 'Record hebdo', `${t.bestWeek.km.toFixed(0)} km`, fmtDate(t.bestWeek.week, { month: 'short', year: '2-digit' })) : null,
        t?.bestMonth ? trophy('🗓️', 'Record mensuel', `${t.bestMonth.km.toFixed(0)} km`, t.bestMonth.label) : null,
      ),
    ));
  }

  // --- Discipline : comment tu t'entraînes ---
  const disc = disciplineStats(ctx.programs, ctx.activities);
  if (disc.totalDone > 0) {
    const DAY_NAMES = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
    const typeRows = Object.entries(disc.byType)
      .filter(([, v]) => v.total > 0)
      .sort((a, b) => b[1].total - a[1].total)
      .map(([type, v]) => {
        const st = SESSION_TYPES[type] || SESSION_TYPES.ef;
        const pct = v.done / v.total;
        return el('div', { class: 'disc-row' },
          el('span', { class: 'type-pill', style: `background:${st.color}` }, st.label),
          el('div', { class: 'disc-bar' }, el('div', { style: `width:${Math.round(pct * 100)}%;background:${st.color}` })),
          el('span', { class: 'small', style: 'min-width:52px;text-align:right' }, `${v.done}/${v.total}`));
      });
    root.append(el('div', { class: 'card' },
      el('div', { class: 'card-title' }, '🎖️ Discipline d’entraînement'),
      el('div', { class: 'muted small', style: 'margin-bottom:8px' },
        `${disc.totalDone} séances validées (${disc.withLink} liées à une activité)`
        + (disc.favDay != null ? ` · jour favori : ${DAY_NAMES[disc.favDay]}` : '')
        + (disc.avgHour != null ? ` · départ moyen ${Math.floor(disc.avgHour)} h ${String(Math.round((disc.avgHour % 1) * 60)).padStart(2, '0')}` : '')),
      el('div', { class: 'muted small', style: 'margin-bottom:4px' }, 'Taux de complétion par type de séance (hors optionnelles) :'),
      ...typeRows,
    ));
  }

  // --- Avancement des programmes ---
  for (const p of ctx.programs) {
    const stats = programStats(p);
    const blocks = [...blockGroups(p)];
    root.append(el('div', { class: 'card' },
      el('div', { class: 'card-title' }, `${p.archived ? '📦' : '🗺️'} ${p.name}`),
      el('div', { class: 'prog-bar' }, el('div', { style: `width:${Math.round(stats.completion * 100)}%` })),
      el('div', { class: 'muted small' }, `${stats.completed}/${stats.total} séances · ${stats.kmDone.toFixed(0)} km courus · ${stats.weeksComplete}/${p.weeks.length} semaines complètes`),
      el('div', { class: 'block-medals' },
        ...blocks.map(([name, weeks]) => {
          const done = weeks.every(weekComplete);
          return el('div', { class: `medal ${done ? 'medal-on' : ''}`, title: name },
            el('span', {}, done ? '🏅' : '⚪'), el('span', { class: 'small' }, name.replace(/^Bloc \d+ — /, '')));
        })),
      // mini heatmap des séances
      el('div', { class: 'heatmap' },
        ...p.weeks.map(w => el('div', { class: 'heat-week' },
          ...w.sessions.slice().sort((a, b) => a.day - b.day).map(s =>
            el('span', {
              class: `heat-cell ${s.completed ? 'on' : ''}`,
              style: s.completed ? `background:${SESSION_TYPES[s.type].color}` : '',
              title: `S${w.num} · ${s.title}`,
            }))))),
    ));
  }
}
