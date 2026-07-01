// ============================================================
// RunQuest — Vue Progression : niveaux, badges, trophées, streak
// ============================================================

import { el, fmtDate } from '../utils.js';
import { LEVELS, levelFor, computeXp, BADGES, earnedBadges, weeklyStreak, programStats, blockGroups, weekComplete } from '../gamification.js';
import { SESSION_TYPES } from '../program-data.js';

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
