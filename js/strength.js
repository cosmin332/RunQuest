// ============================================================
// RunQuest — musculation : calculs et suivi inter-séances.
// Un « log » est une séance de muscu réalisée (voir db.js store 'strength').
// ============================================================

import { getStrengthLogs, saveStrengthLog, deleteStrengthLog } from './db.js';
import { isoDay, addDays } from './utils.js';

export { getStrengthLogs, saveStrengthLog, deleteStrengthLog };

// clé de rapprochement d'un exercice entre séances (nom normalisé)
export function exKey(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// 1RM estimée (Epley) : poids × (1 + reps/30)
export function e1rm(weight, reps) {
  if (!weight || !reps) return null;
  return weight * (1 + reps / 30);
}

// tonnage d'un log = Σ poids×reps sur toutes les séries renseignées
export function logTonnage(log) {
  let t = 0;
  for (const ex of log.exercises || [])
    for (const s of ex.sets || [])
      if (s.weight && s.reps) t += s.weight * s.reps;
  return Math.round(t);
}

// séries effectivement réalisées (au moins reps renseignées)
export function loggedSets(ex) {
  return (ex.sets || []).filter(s => s.reps != null && s.reps !== '');
}

// Dernière séance ayant travaillé cet exercice (avant `beforeIso` si fourni).
// Retourne { date, ex } ou null.
export function lastForExercise(logs, name, beforeIso = null) {
  const key = exKey(name);
  for (const log of logs) { // logs triés du + récent au + ancien
    if (beforeIso && log.date >= beforeIso) continue;
    const ex = (log.exercises || []).find(e => exKey(e.name) === key && loggedSets(e).length);
    if (ex) return { date: log.date, ex };
  }
  return null;
}

// meilleure série d'un exercice dans un log (par poids, puis reps)
export function topSet(ex) {
  let best = null;
  for (const s of loggedSets(ex)) {
    if (!best || (s.weight || 0) > (best.weight || 0) || ((s.weight || 0) === (best.weight || 0) && (s.reps || 0) > (best.reps || 0))) best = s;
  }
  return best;
}

// ---- Statistiques ----

export function totals(logs, sinceDays = 30) {
  const cutoff = isoDay(addDays(new Date(), -sinceDays));
  const recent = logs.filter(l => isoDay(l.date) >= cutoff);
  const exNames = new Set();
  for (const l of logs) for (const ex of l.exercises || []) if (loggedSets(ex).length) exNames.add(exKey(ex.name));
  return {
    sessions30: recent.length,
    tonnage30: recent.reduce((a, l) => a + logTonnage(l), 0),
    sessionsAll: logs.length,
    tonnageAll: logs.reduce((a, l) => a + logTonnage(l), 0),
    exercisesTracked: exNames.size,
    firstDate: logs.length ? logs[logs.length - 1].date : null,
  };
}

// tonnage par séance (chronologique)
export function tonnageSeries(logs) {
  return [...logs].reverse().map(l => ({ date: isoDay(l.date), tonnage: logTonnage(l), title: l.title }));
}

// Progression par exercice : pour chaque exercice suivi, historique des tops sets.
// Retourne [{ name, key, points:[{date, weight, reps, e1rm}], best:{weight,reps,e1rm,date}, sessions }]
export function exerciseProgress(logs) {
  const byEx = new Map();
  for (const log of [...logs].reverse()) { // ancien -> récent
    for (const ex of log.exercises || []) {
      const ts = topSet(ex);
      if (!ts) continue;
      const key = exKey(ex.name);
      if (!byEx.has(key)) byEx.set(key, { name: ex.name, key, points: [] });
      byEx.get(key).points.push({ date: isoDay(log.date), weight: ts.weight || 0, reps: ts.reps || 0, e1rm: e1rm(ts.weight, ts.reps) });
    }
  }
  const out = [];
  for (const e of byEx.values()) {
    let best = null;
    for (const p of e.points) if (!best || (p.e1rm || 0) > (best.e1rm || 0)) best = p;
    out.push({ ...e, best, sessions: e.points.length });
  }
  // les plus travaillés d'abord
  return out.sort((a, b) => b.sessions - a.sessions);
}

// Records personnels récents (poids max ou e1RM battus dans les 45 j)
export function recentPRs(logs, days = 45) {
  const cutoff = isoDay(addDays(new Date(), -days));
  const prog = exerciseProgress(logs);
  const prs = [];
  for (const ex of prog) {
    if (!ex.best || ex.best.date < cutoff) continue;
    // le best est-il le dernier point ? (PR tout récent)
    const isLatest = ex.points[ex.points.length - 1].date === ex.best.date;
    if (isLatest && ex.points.length > 1) prs.push({ name: ex.name, ...ex.best });
  }
  return prs.sort((a, b) => b.date.localeCompare(a.date));
}
