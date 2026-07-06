// ============================================================
// RunQuest — gamification : XP, niveaux, badges, streaks
// L'XP est recalculée de façon déterministe depuis l'état des programmes
// (pas de compteur incrémental => pas de dérive possible).
// ============================================================

import { SESSION_TYPES } from './program-data.js';
import { getState, setState } from './db.js';
import { mondayOf, addDays, isoDay, weekKey, sum, mean } from './utils.js';

export const XP_BONUS = { week: 100, block: 300, program: 1000, badge: 25 };

export const LEVELS = [
  { lvl: 1, xp: 0, name: 'Jeune Pousse', icon: '🌱' },
  { lvl: 2, xp: 200, name: 'Jogger du Dimanche', icon: '🐢' },
  { lvl: 3, xp: 500, name: 'Coureur Régulier', icon: '👟' },
  { lvl: 4, xp: 1000, name: 'Routard du Bitume', icon: '🛣️' },
  { lvl: 5, xp: 1800, name: 'Foulée Légère', icon: '🪶' },
  { lvl: 6, xp: 2800, name: 'Machine à Kilomètres', icon: '⚙️' },
  { lvl: 7, xp: 4000, name: 'Chasseur de Chrono', icon: '⏱️' },
  { lvl: 8, xp: 5500, name: 'Métronome', icon: '🎯' },
  { lvl: 9, xp: 7500, name: 'Élite du Quartier', icon: '🔥' },
  { lvl: 10, xp: 10000, name: 'Légende du Bitume', icon: '👑' },
];

export function levelFor(xp) {
  let cur = LEVELS[0];
  for (const l of LEVELS) if (xp >= l.xp) cur = l;
  const next = LEVELS.find(l => l.xp > xp) || null;
  const progress = next ? (xp - cur.xp) / (next.xp - cur.xp) : 1;
  return { ...cur, next, progress };
}

// ---------- Helpers programme ----------

export function allSessions(program) {
  return (program.weeks || []).flatMap(w => w.sessions.map(s => ({ ...s, _week: w })));
}

export function sessionDate(program, week, session) {
  // décalage manuel/intelligent éventuel (voir reschedule.js)
  if (session.plannedDate) return new Date(session.plannedDate + 'T12:00:00');
  const start = mondayOf(new Date(program.startDate + 'T12:00:00'));
  const d = addDays(start, (week.num - 1) * 7 + session.day);
  d.setHours(12, 0, 0, 0); // midi : évite les demi-journées dans les calculs de retard
  return d;
}

export function weekComplete(week) {
  const required = week.sessions.filter(s => !s.optional);
  return required.length > 0 && required.every(s => s.completed);
}

export function blockGroups(program) {
  const groups = new Map();
  for (const w of program.weeks) {
    if (!groups.has(w.block)) groups.set(w.block, []);
    groups.get(w.block).push(w);
  }
  return groups;
}

export function programComplete(program) {
  return program.weeks.every(w => weekComplete(w));
}

// Statistiques d'avancement d'un programme
export function programStats(program) {
  const sessions = allSessions(program);
  const runs = sessions.filter(s => !['renfo', 'repos'].includes(s.type));
  const completed = sessions.filter(s => s.completed);
  const today = new Date(); today.setHours(23, 59, 59);
  const due = sessions.filter(s => !s.optional && sessionDate(program, s._week, s) <= today);
  const dueCompleted = due.filter(s => s.completed);
  const start = mondayOf(new Date(program.startDate + 'T12:00:00'));
  const weekIdx = Math.floor((mondayOf(today) - start) / (7 * 86400000)) + 1;
  return {
    total: sessions.length,
    totalRuns: runs.length,
    completed: completed.length,
    completedRuns: runs.filter(s => s.completed).length,
    completion: sessions.length ? completed.length / sessions.length : 0,
    completionDue: due.length ? dueCompleted.length / due.length : 1,
    dueCount: due.length,
    dueCompleted: dueCompleted.length,
    currentWeekNum: weekIdx,
    currentWeek: program.weeks.find(w => w.num === weekIdx) || null,
    kmPlanned: sum(sessions.map(s => s.estKm || 0)),
    kmDone: sum(completed.map(s => (s.actual?.distance ? s.actual.distance / 1000 : s.estKm || 0))),
    weeksComplete: program.weeks.filter(weekComplete).length,
  };
}

// ---------- XP ----------

export function computeXp(programs) {
  let xp = 0;
  for (const p of programs) {
    for (const w of p.weeks) {
      for (const s of w.sessions) {
        if (s.completed) xp += SESSION_TYPES[s.type]?.xp || 30;
      }
      if (weekComplete(w)) xp += XP_BONUS.week;
    }
    for (const [, weeks] of blockGroups(p)) {
      if (weeks.every(weekComplete)) xp += XP_BONUS.block;
    }
    if (programComplete(p)) xp += XP_BONUS.program;
  }
  const gamif = getState('gamification', { badges: {} });
  xp += Object.keys(gamif.badges || {}).length * XP_BONUS.badge;
  return xp;
}

// ---------- Streak : semaines consécutives avec ≥ 2 séances validées ----------

export function weeklyStreak(programs) {
  const byWeek = new Map();
  for (const p of programs) {
    for (const w of p.weeks) {
      for (const s of w.sessions) {
        if (!s.completed) continue;
        const d = s.completedAt || isoDay(sessionDate(p, w, s));
        const k = weekKey(d);
        byWeek.set(k, (byWeek.get(k) || 0) + 1);
      }
    }
  }
  let streak = 0;
  let cursor = mondayOf(new Date());
  // la semaine en cours compte si ≥ 2 séances déjà faites, sinon on part de la précédente
  if ((byWeek.get(isoDay(cursor)) || 0) >= 2) streak = 1;
  cursor = addDays(cursor, -7);
  while ((byWeek.get(isoDay(cursor)) || 0) >= 2) { streak++; cursor = addDays(cursor, -7); }
  return streak;
}

// ---------- Badges ----------
// check(ctx) -> bool ; ctx = { programs, activities, importLog, streak }

export const BADGES = [
  { id: 'first-session', icon: '🎬', name: 'Premier pas', desc: 'Valider ta première séance',
    check: c => c.completedCount >= 1 },
  { id: 'sessions-10', icon: '🔟', name: 'Dans le rythme', desc: '10 séances validées',
    check: c => c.completedCount >= 10 },
  { id: 'sessions-25', icon: '📅', name: 'Assidu', desc: '25 séances validées',
    check: c => c.completedCount >= 25 },
  { id: 'sessions-50', icon: '🗓️', name: 'Inarrêtable', desc: '50 séances validées',
    check: c => c.completedCount >= 50 },
  { id: 'perfect-week', icon: '✨', name: 'Semaine parfaite', desc: 'Toutes les séances d’une semaine validées',
    check: c => c.programs.some(p => p.weeks.some(weekComplete)) },
  { id: 'block-1', icon: '🧱', name: 'Fondations posées', desc: 'Bloc Développement terminé',
    check: c => c.programs.some(p => [...blockGroups(p)].some(([name, weeks]) => /bloc 1|développement/i.test(name) && weeks.every(weekComplete))) },
  { id: 'test-done', icon: '🧪', name: 'Vérité du chrono', desc: 'Test 10 km de la semaine 5 réalisé',
    check: c => c.programs.some(p => allSessions(p).some(s => s.type === 'test' && s.completed)) },
  { id: 'block-2', icon: '🏗️', name: 'Spécifique encaissé', desc: 'Bloc Spécifique terminé',
    check: c => c.programs.some(p => [...blockGroups(p)].some(([name, weeks]) => /bloc 2|spécifique/i.test(name) && weeks.every(weekComplete))) },
  { id: 'program-done', icon: '🏆', name: 'Plan bouclé', desc: 'Programme complet terminé',
    check: c => c.programs.some(p => !p.archived && programComplete(p)) },
  { id: 'race-done', icon: '🏁', name: 'Jour J', desc: 'Course objectif courue',
    check: c => c.programs.some(p => allSessions(p).some(s => s.type === 'course' && s.completed)) },
  { id: 'sub50', icon: '💎', name: 'SUB 50 !', desc: '10 km couru en moins de 50 minutes',
    check: c => c.activities.some(a => a.sport === 'run' && a.distance >= 9950 && a.movingTime && a.movingTime <= 3000)
      || c.programs.some(p => allSessions(p).some(s => ['course', 'test'].includes(s.type) && s.completed && s.actual?.distance >= 9950 && s.actual?.duration <= 3000)) },
  { id: 'streak-3', icon: '🔥', name: 'Ça chauffe', desc: '3 semaines d’affilée avec 2+ séances',
    check: c => c.streak >= 3 },
  { id: 'streak-6', icon: '🌋', name: 'En fusion', desc: '6 semaines d’affilée avec 2+ séances',
    check: c => c.streak >= 6 },
  { id: 'streak-10', icon: '☄️', name: 'Comète', desc: '10 semaines d’affilée avec 2+ séances',
    check: c => c.streak >= 10 },
  { id: 'renfo-10', icon: '🦵', name: 'Tibias blindés', desc: '10 séances de renfo validées',
    check: c => c.renfoCount >= 10 },
  { id: 'early-bird', icon: '🌅', name: 'Lève-tôt', desc: 'Une séance validée avec une course avant 7 h',
    check: c => c.linkedActivities.some(a => new Date(a.date).getHours() < 7) },
  { id: 'km-100', icon: '💯', name: 'Centurion', desc: '100 km courus pendant un programme',
    check: c => c.programs.some(p => programStats(p).kmDone >= 100) },
  { id: 'km-1000', icon: '🌍', name: 'Globe-trotteur', desc: '1000 km au total (toutes activités)',
    check: c => sum(c.activities.filter(a => a.sport === 'run').map(a => a.distance || 0)) >= 1000000 },
  { id: 'data-nerd', icon: '🤓', name: 'Data nerd', desc: 'Importer Santé + archive Strava + sync API',
    check: c => c.importLog?.health && c.importLog?.archive && c.importLog?.api },
  { id: 'long-run', icon: '🦌', name: 'Grand fond', desc: 'Une sortie de 15 km ou plus',
    check: c => c.activities.some(a => a.sport === 'run' && a.distance >= 15000) },
];

function buildContext(programs, activities) {
  const sessions = programs.flatMap(p => allSessions(p));
  const completedSessions = sessions.filter(s => s.completed);
  const linkedIds = new Set(completedSessions.map(s => s.activityId).filter(Boolean));
  return {
    programs,
    activities,
    importLog: getState('importLog', {}),
    streak: weeklyStreak(programs),
    completedCount: completedSessions.length,
    renfoCount: completedSessions.filter(s => s.type === 'renfo').length,
    linkedActivities: activities.filter(a => linkedIds.has(a.id)),
  };
}

// Évalue les badges ; retourne ceux nouvellement gagnés et persiste.
export function evaluateBadges(programs, activities) {
  const gamif = getState('gamification', { badges: {} });
  gamif.badges = gamif.badges || {};
  const ctx = buildContext(programs, activities);
  const fresh = [];
  for (const b of BADGES) {
    if (gamif.badges[b.id]) continue;
    try {
      if (b.check(ctx)) {
        gamif.badges[b.id] = new Date().toISOString();
        fresh.push(b);
      }
    } catch { /* un badge ne doit jamais casser l'app */ }
  }
  if (fresh.length) setState('gamification', gamif);
  return fresh;
}

export function earnedBadges() {
  const gamif = getState('gamification', { badges: {} });
  return gamif.badges || {};
}

// ---------- Timeline d'XP cumulée ----------
// Reconstruit les gains datés : séances (completedAt), bonus de semaine
// (à la date de la dernière séance de la semaine), badges (+25).

export function xpTimeline(programs) {
  const events = [];
  for (const p of programs) {
    for (const w of p.weeks) {
      let lastDate = null;
      for (const s of w.sessions) {
        if (!s.completed) continue;
        const d = s.completedAt || isoDay(sessionDate(p, w, s));
        events.push({ date: d, xp: SESSION_TYPES[s.type]?.xp || 30 });
        if (!lastDate || d > lastDate) lastDate = d;
      }
      if (weekComplete(w) && lastDate) events.push({ date: lastDate, xp: XP_BONUS.week });
    }
  }
  const badges = earnedBadges();
  for (const dateIso of Object.values(badges)) {
    events.push({ date: isoDay(dateIso), xp: XP_BONUS.badge });
  }
  events.sort((a, b) => a.date.localeCompare(b.date));
  let cum = 0;
  const byDay = new Map();
  for (const e of events) {
    cum += e.xp;
    byDay.set(e.date, cum);
  }
  return [...byDay.entries()].map(([date, xp]) => ({ date, xp }));
}

// ---------- Discipline : comment tu t'entraînes vraiment ----------

export function disciplineStats(programs, activities) {
  const sessions = programs.flatMap(p => allSessions(p));
  const done = sessions.filter(s => s.completed);

  // taux de complétion par type (uniquement séances passées ou faites)
  const today = new Date(); today.setHours(23, 59, 59);
  const byType = {};
  for (const p of programs) {
    for (const w of p.weeks) {
      for (const s of w.sessions) {
        const due = s.completed || sessionDate(p, w, s) <= today;
        if (!due || s.optional) continue;
        if (!byType[s.type]) byType[s.type] = { done: 0, total: 0 };
        byType[s.type].total++;
        if (s.completed) byType[s.type].done++;
      }
    }
  }

  // jour de la semaine et heure des activités liées
  const linkedIds = new Set(done.map(s => s.activityId).filter(Boolean));
  const linked = activities.filter(a => linkedIds.has(a.id));
  const dayCount = Array(7).fill(0);
  const hours = [];
  for (const a of linked) {
    const d = new Date(a.date);
    dayCount[(d.getDay() + 6) % 7]++;
    hours.push(d.getHours() + d.getMinutes() / 60);
  }
  const favDay = dayCount.some(c => c) ? dayCount.indexOf(Math.max(...dayCount)) : null;

  return {
    byType,
    dayCount,
    favDay,
    avgHour: hours.length ? hours.reduce((a, b) => a + b, 0) / hours.length : null,
    totalDone: done.length,
    withLink: done.filter(s => s.activityId).length,
  };
}

// ---------- Défis de la semaine (motivationnels, recalculés en continu) ----------

export function weeklyQuests(programs, activities) {
  const monday = mondayOf(new Date());
  const weekIso = isoDay(monday);
  const inWeek = d => weekKey(d) === weekIso;

  const sessions = programs.flatMap(p => p.weeks.flatMap(w =>
    w.sessions.map(s => ({ ...s, _p: p, _w: w }))));
  const doneThisWeek = sessions.filter(s => s.completed && s.completedAt && inWeek(s.completedAt));
  const runsThisWeek = activities.filter(a => a.sport === 'run' && inWeek(a.date));
  const kmWeek = sum(runsThisWeek.map(a => (a.distance || 0) / 1000));

  const active = programs.find(p => !p.archived);
  const currentWeek = active ? active.weeks.find(w => w.num === programStats(active).currentWeekNum) : null;
  const plannedCount = currentWeek ? currentWeek.sessions.filter(s => !s.optional && !['repos'].includes(s.type)).length : 5;

  return [
    { icon: '✅', label: 'Valider les séances de la semaine', cur: doneThisWeek.length, target: Math.max(plannedCount, 1) },
    { icon: '🦵', label: '2 renfos tibias & gainage', cur: doneThisWeek.filter(s => s.type === 'renfo').length, target: 2 },
    { icon: '🛣️', label: currentWeek?.targetKm ? `~${currentWeek.targetKm} km dans la semaine` : '20 km dans la semaine', cur: +kmWeek.toFixed(1), target: currentWeek?.targetKm || 20 },
    { icon: '🐢', label: 'Au moins 2 sorties « vraiment lentes »', cur: runsThisWeek.filter(a => { const p = a.distance && a.movingTime ? a.movingTime / (a.distance / 1000) : 0; return p >= 370; }).length, target: 2 },
  ].map(q => ({ ...q, done: q.cur >= q.target, pct: Math.min(q.cur / q.target, 1) }));
}
