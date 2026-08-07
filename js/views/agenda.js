// ============================================================
// RunQuest — Vue Agenda : toutes les séances à venir (running + muscu)
// par jour / semaine / mois, avec horaires (run 05:00, muscu le soir).
// ============================================================

import { el, fmtDate, isoDay, mondayOf, addDays } from '../utils.js';
import { sessionDateTime, sessionTime, sessionDate } from '../gamification.js';
import { loggedInWeek } from '../strength.js';
import { SESSION_TYPES } from '../program-data.js';

const DAY_NAMES = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

function collect(programs, cursor, logs) {
  const out = [];
  const from = mondayOf(addDays(cursor, -42)), to = mondayOf(addDays(cursor, 42));
  for (const p of programs) {
    if (p.archived) continue;
    if (p.recurring) {
      // template hebdo : on projette chaque séance sur toutes les semaines visibles
      for (const w of p.weeks) for (const s of w.sessions) {
        const time = sessionTime(s);
        for (let m = new Date(from); m <= to; m = addDays(m, 7)) {
          const dt = addDays(m, s.day);
          if (time) { const [h, mm] = time.split(':').map(Number); dt.setHours(h, mm || 0, 0, 0); }
          out.push({ program: p, week: w, session: s, dt, time, recurring: true, occ: isoDay(dt), done: loggedInWeek(logs, s.id, isoDay(m)) });
        }
      }
    } else {
      for (const w of p.weeks) for (const s of w.sessions) {
        out.push({ program: p, week: w, session: s, dt: sessionDateTime(p, w, s), time: sessionTime(s), done: !!s.completed });
      }
    }
  }
  return out.sort((a, b) => a.dt - b.dt);
}

function openSession(item, ctx) {
  if (item.session.type === 'muscu') ctx.navigate('workout', { programId: item.program.id, sessionId: item.session.id, ...(item.recurring ? { date: item.occ } : {}) });
  else if (item.program.recurring) ctx.navigate('program', { programId: item.program.id });
  else ctx.navigate('program', { programId: item.program.id, week: item.week.num });
}

export function renderAgenda(root, ctx) {
  const mode = ctx.params?.mode || 'semaine';
  const cursor = ctx.params?.date ? new Date(ctx.params.date + 'T12:00:00') : new Date();
  const all = collect(ctx.programs, cursor, ctx.strengthLogs || []);

  root.append(el('div', { class: 'subtabs' },
    ...[['jour', '📆 Jour'], ['semaine', '🗓️ Semaine'], ['mois', '📅 Mois']].map(([m, label]) =>
      el('button', { class: `chip ${mode === m ? 'chip-on' : ''}`, onclick: () => ctx.navigate('agenda', { mode: m, date: isoDay(cursor) }) }, label))));

  if (!all.length) {
    root.append(el('div', { class: 'card muted' }, 'Aucune séance planifiée. Importe un programme dans l’onglet Programme.'));
    return;
  }

  ({ jour: dayView, semaine: weekView, mois: monthView }[mode] || weekView)(root, ctx, all, cursor);
}

// ---- helpers d'affichage ----

function sessionsOn(all, date) {
  const key = isoDay(date);
  return all.filter(x => isoDay(x.dt) === key).sort((a, b) => a.dt - b.dt);
}

function navBar(ctx, mode, cursor, label, stepDays) {
  return el('div', { class: 'agenda-nav' },
    el('button', { class: 'btn btn-ghost small', onclick: () => ctx.navigate('agenda', { mode, date: isoDay(addDays(cursor, -stepDays)) }) }, '‹'),
    el('button', { class: 'btn btn-ghost small', onclick: () => ctx.navigate('agenda', { mode, date: isoDay(new Date()) }) }, label),
    el('button', { class: 'btn btn-ghost small', onclick: () => ctx.navigate('agenda', { mode, date: isoDay(addDays(cursor, stepDays)) }) }, '›'),
  );
}

function sessionLine(item, ctx, compact = false) {
  const t = SESSION_TYPES[item.session.type] || SESSION_TYPES.ef;
  const done = item.done;
  const dist = item.session.estKm ? `${item.session.estKm} km` : '';
  const dur = item.session.estMin ? `${item.session.estMin} min` : '';
  const meta = [dist, dur].filter(Boolean).join(' · ');
  return el('div', { class: `ag-item ${done ? 'ag-done' : ''}`, onclick: () => openSession(item, ctx) },
    el('span', { class: 'ag-time' }, item.time || '—'),
    el('span', { class: 'ag-dot', style: `background:${t.color}` }),
    el('div', { class: 'ag-body' },
      el('div', { class: 'ag-title' }, done ? '✅ ' : '', item.session.title),
      compact ? null : el('div', { class: 'muted small' }, `${t.label}${meta ? ' · ' + meta : ''} · S${item.week.num} — ${item.program.name}`),
    ),
  );
}

// ---- Jour ----

function dayView(root, ctx, all, cursor) {
  root.append(navBar(ctx, 'jour', cursor, fmtDate(cursor, { weekday: 'long', day: 'numeric', month: 'long' }), 1));
  const items = sessionsOn(all, cursor);
  if (!items.length) {
    root.append(el('div', { class: 'card muted' }, isoDay(cursor) === isoDay(new Date()) ? 'Repos aujourd’hui — profites-en pour récupérer 😴' : 'Aucune séance ce jour.'));
    return;
  }
  const card = el('div', { class: 'card' });
  items.forEach(it => card.append(sessionLine(it, ctx)));
  root.append(card);
}

// ---- Semaine ----

function weekView(root, ctx, all, cursor) {
  const monday = mondayOf(cursor);
  const label = `${fmtDate(monday, { day: 'numeric', month: 'short' })} – ${fmtDate(addDays(monday, 6), { day: 'numeric', month: 'short' })}`;
  root.append(navBar(ctx, 'semaine', cursor, label, 7));
  const todayKey = isoDay(new Date());
  for (let i = 0; i < 7; i++) {
    const day = addDays(monday, i);
    const items = sessionsOn(all, day);
    const isToday = isoDay(day) === todayKey;
    const card = el('div', { class: `card ag-day ${isToday ? 'ag-today' : ''}` },
      el('div', { class: 'ag-day-head' },
        el('span', { class: 'ag-day-name' }, `${DAY_NAMES[i]} ${day.getDate()}`),
        isToday ? el('span', { class: 'now-chip' }, 'aujourd’hui') : null,
        items.length ? null : el('span', { class: 'muted small' }, 'repos'),
      ),
      ...items.map(it => sessionLine(it, ctx, true)),
    );
    root.append(card);
  }
}

// ---- Mois ----

function monthView(root, ctx, all, cursor) {
  const year = cursor.getFullYear(), month = cursor.getMonth();
  const first = new Date(year, month, 1, 12);
  const label = cursor.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  root.append(el('div', { class: 'agenda-nav' },
    el('button', { class: 'btn btn-ghost small', onclick: () => ctx.navigate('agenda', { mode: 'mois', date: isoDay(new Date(year, month - 1, 15)) }) }, '‹'),
    el('button', { class: 'btn btn-ghost small', onclick: () => ctx.navigate('agenda', { mode: 'mois', date: isoDay(new Date()) }) }, label),
    el('button', { class: 'btn btn-ghost small', onclick: () => ctx.navigate('agenda', { mode: 'mois', date: isoDay(new Date(year, month + 1, 15)) }) }, '›'),
  ));

  const offset = (first.getDay() + 6) % 7; // lundi = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayKey = isoDay(new Date());

  const grid = el('div', { class: 'card month-grid' });
  DAY_NAMES.forEach(d => grid.append(el('div', { class: 'month-dow' }, d)));
  for (let i = 0; i < offset; i++) grid.append(el('div', { class: 'month-cell empty' }));
  for (let d = 1; d <= daysInMonth; d++) {
    const day = new Date(year, month, d, 12);
    const items = sessionsOn(all, day);
    const isToday = isoDay(day) === todayKey;
    const dots = items.slice(0, 4).map(it => el('span', { class: 'month-dot', style: `background:${(SESSION_TYPES[it.session.type] || SESSION_TYPES.ef).color}` }));
    grid.append(el('div', {
      class: `month-cell ${isToday ? 'today' : ''} ${items.length ? 'has' : ''}`,
      onclick: () => ctx.navigate('agenda', { mode: 'jour', date: isoDay(day) }),
    },
      el('span', { class: 'month-num' }, String(d)),
      el('div', { class: 'month-dots' }, ...dots),
    ));
  }
  root.append(grid);

  // légende
  const kinds = [...new Set(all.map(x => x.session.type))];
  root.append(el('div', { class: 'card ag-legend' },
    ...kinds.map(k => el('span', { class: 'ag-legend-item' },
      el('span', { class: 'month-dot', style: `background:${(SESSION_TYPES[k] || SESSION_TYPES.ef).color}` }),
      (SESSION_TYPES[k] || {}).label || k))));
}
