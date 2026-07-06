// ============================================================
// RunQuest — replanification intelligente.
//
// Philosophie (pour ne PAS être contre-productif) :
//  - On protège l'ESPACEMENT local : ≥ 48 h entre deux séances de qualité,
//    jamais deux séances dures d'affilée. C'est une contrainte de quelques jours.
//  - On NE décale PAS tout le plan à chaque petit retard : sinon la date
//    d'objectif dérive et le plan de 10 semaines gonfle sans fin.
//  => Le décalage automatique est LOCAL (reste de la semaine en cours) et
//     ne s'active que s'il y a réellement un conflit d'espacement.
//  => Le recalage global (toute la suite) reste une action MANUELLE explicite,
//     réservée aux vrais trous (maladie, voyage), avec effet sur l'objectif affiché.
//
// Le décalage se matérialise par une propriété optionnelle `plannedDate` (ISO)
// sur la séance ; sessionDate() la prend en compte si présente.
// ============================================================

import { isoDay, addDays } from './utils.js';
import { sessionDate } from './gamification.js';

export const QUALITY_TYPES = new Set(['vma', 'seuil', 'spe', 'test', 'course']);

// Retard (jours) entre la date prévue et la date réelle de réalisation.
export function completionDelay(program, week, session) {
  if (!session.completedAt) return 0;
  const planned = sessionDate(program, week, session);
  const actual = new Date(session.completedAt + 'T12:00:00');
  return Math.round((actual - planned) / 86400000);
}

// Séances non validées de la semaine situées après l'ancre (jour d'origine).
function laterInWeek(week, anchorSession) {
  return week.sessions
    .filter(s => !s.completed && s.day > anchorSession.day)
    .sort((a, b) => a.day - b.day);
}

// Un décalage est-il UTILE ? On ne le propose QUE s'il y a un vrai conflit :
//  1) une séance de qualité se retrouve à moins de 48 h de la réalisation réelle ;
//  2) une autre séance courue tomberait le jour même / avant la réalisation réelle.
// Sinon (retard absorbable par un simple jour facile), on ne touche à rien —
// décaler pour rien serait plus perturbant qu'utile.
export function shiftIsUseful(program, week, anchorSession, delta) {
  if (delta <= 0 || !anchorSession.completedAt) return false;
  const later = laterInWeek(week, anchorSession);
  if (!later.length) return false;
  const anchorActual = new Date(anchorSession.completedAt + 'T12:00:00');
  const nextQ = later.find(s => QUALITY_TYPES.has(s.type));
  if (nextQ) {
    const gap = Math.round((sessionDate(program, week, nextQ) - anchorActual) / 86400000);
    if (gap < 2) return true;
  }
  return later.some(s => !['renfo', 'repos'].includes(s.type) && sessionDate(program, week, s) <= anchorActual);
}

// Décalage proposé (préserve l'espacement d'origine) pour le reste de la semaine.
// Retourne [{ session, week, fromIso, toIso, title, type, spillsNextWeek }].
export function proposeWeekShift(program, week, anchorSession, delta) {
  if (delta <= 0) return [];
  const weekEnd = sessionDate(program, week, { day: 6 });
  return laterInWeek(week, anchorSession).map(s => {
    const from = sessionDate(program, week, s);
    const to = addDays(from, delta);
    return {
      session: s, week, title: s.title, type: s.type,
      fromIso: isoDay(from), toIso: isoDay(to),
      spillsNextWeek: to > weekEnd,
    };
  });
}

// Recale TOUTE la suite non validée pour que la prochaine séance due tombe le
// `targetIso`. Retourne { changes, delta } (delta en jours, >0 = plus tard).
export function reanchorFrom(program, targetIso) {
  const dated = [];
  for (const w of program.weeks)
    for (const s of w.sessions)
      if (!s.completed) dated.push({ s, w, date: sessionDate(program, w, s) });
  if (!dated.length) return { changes: [], delta: 0 };
  dated.sort((a, b) => a.date - b.date);
  const delta = Math.round((new Date(targetIso + 'T12:00:00') - dated[0].date) / 86400000);
  const changes = dated.map(d => ({
    session: d.s, week: d.w, fromIso: isoDay(d.date), toIso: isoDay(addDays(d.date, delta)),
  }));
  return { changes, delta };
}

// Séance-objectif (course, sinon dernière séance datée du plan).
export function goalSession(program) {
  let course = null, last = null;
  for (const w of program.weeks) {
    for (const s of w.sessions) {
      if (s.type === 'course') course = { s, w };
      last = { s, w };
    }
  }
  return course || last;
}

export function applyShift(changes) {
  for (const c of changes) c.session.plannedDate = c.toIso;
}

// Supprime tous les décalages : retour au calendrier d'origine.
export function resetDates(program) {
  let n = 0;
  for (const w of program.weeks) for (const s of w.sessions) if (s.plannedDate) { delete s.plannedDate; n++; }
  return n;
}
