// ============================================================
// RunQuest — Vue Programme : plan semaine par semaine, validation
// des séances en les liant à une activité importée.
// ============================================================

import { el, fmtKm, fmtPace, fmtDuration, fmtDate, paceOf, toast, confetti, isoDay, downloadJson, readFileAsText } from '../utils.js';
import { SESSION_TYPES, validateProgram } from '../program-data.js';
import { sessionDate, weekComplete, programStats, allSessions } from '../gamification.js';
import { setState } from '../db.js';

export function renderProgram(root, ctx) {
  const { programs } = ctx;
  const active = programs.filter(p => !p.archived);
  const archived = programs.filter(p => p.archived);
  const program = ctx.params?.programId
    ? programs.find(p => p.id === ctx.params.programId)
    : active[0] || programs[0];

  // --- Barre d'outils : sélection programme + import ---
  const toolbar = el('div', { class: 'prog-toolbar' },
    programs.length > 1
      ? el('select', {
          class: 'input',
          onchange: e => ctx.navigate('program', { programId: e.target.value }),
        }, ...programs.map(p => {
          const o = el('option', { value: p.id }, (p.archived ? '📦 ' : '') + p.name);
          if (program && p.id === program.id) o.selected = true;
          return o;
        }))
      : null,
    el('button', { class: 'btn btn-ghost', onclick: () => importProgramFile(ctx) }, '📥 Importer un programme'),
    el('button', { class: 'btn btn-ghost', onclick: () => showFormatHelp() }, '❓ Format'),
  );
  root.append(toolbar);

  if (!program) {
    root.append(el('div', { class: 'card muted' }, 'Aucun programme. Importe un programme JSON ou restaure une sauvegarde.'));
    return;
  }

  const stats = programStats(program);

  // --- Entête programme ---
  root.append(el('div', { class: 'card prog-head' },
    el('div', { class: 'prog-head-top' },
      el('div', {},
        el('h2', {}, program.name),
        el('div', { class: 'muted small' }, `${program.objective || ''} · début ${fmtDate(program.startDate, { day: 'numeric', month: 'long', year: 'numeric' })}`),
      ),
      el('button', {
        class: 'btn btn-ghost small', title: 'Changer la date de début (lundi de la semaine 1)',
        onclick: () => {
          const d = prompt('Date de début (lundi de la semaine 1), format AAAA-MM-JJ :', program.startDate);
          if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) { program.startDate = d; persist(ctx); ctx.refresh(); }
          else if (d) toast('Format attendu : AAAA-MM-JJ', 'error');
        },
      }, '📆'),
    ),
    el('div', { class: 'prog-progress' },
      el('div', { class: 'prog-bar' }, el('div', { style: `width:${Math.round(stats.completion * 100)}%` })),
      el('span', {}, `${stats.completed}/${stats.total} séances · ${Math.round(stats.completion * 100)} %`),
    ),
    program.paces && Object.keys(program.paces).length
      ? el('div', { class: 'paces' }, ...Object.entries(program.paces).map(([k, v]) =>
          el('span', { class: 'pace-chip' }, el('b', {}, k), ` ${v}/km`)))
      : null,
    program.description ? el('details', { class: 'prog-desc' }, el('summary', {}, 'Consignes & règles de sécurité'), el('p', {}, program.description)) : null,
  ));

  // --- Semaines ---
  const currentNum = stats.currentWeekNum;
  let blockName = null;
  for (const week of program.weeks) {
    if (week.block !== blockName) {
      blockName = week.block;
      const blockWeeks = program.weeks.filter(w => w.block === blockName);
      const done = blockWeeks.filter(weekComplete).length;
      root.append(el('div', { class: 'block-sep' },
        el('span', {}, blockName),
        el('span', { class: 'block-count' }, `${done}/${blockWeeks.length} sem.`),
      ));
    }
    root.append(weekCard(week, program, ctx, week.num === currentNum));
  }
}

function weekCard(week, program, ctx, isCurrent) {
  const complete = weekComplete(week);
  const doneCount = week.sessions.filter(s => s.completed).length;
  const details = el('details', {
    class: `card week-card ${complete ? 'week-done' : ''} ${isCurrent ? 'week-current' : ''}`,
  },
    el('summary', {},
      el('div', { class: 'week-sum' },
        el('span', { class: 'week-num' }, `S${week.num}`),
        el('div', { class: 'week-info' },
          el('div', { class: 'week-title' },
            `Semaine ${week.num}`,
            week.label ? el('span', { class: 'muted' }, ` — ${week.label}`) : null,
            isCurrent ? el('span', { class: 'now-chip' }, 'en cours') : null,
          ),
          el('div', { class: 'muted small' },
            `${fmtDate(sessionDate(program, week, { day: 0 }))} → ${fmtDate(sessionDate(program, week, { day: 6 }))}`
            + (week.targetKm ? ` · cible ~${week.targetKm} km` : '')),
        ),
        el('div', { class: 'week-dots' }, ...week.sessions.map(s =>
          el('span', {
            class: `dot ${s.completed ? 'dot-done' : ''} ${s.optional ? 'dot-opt' : ''}`,
            style: s.completed ? `background:${SESSION_TYPES[s.type].color}` : '',
            title: s.title,
          }))),
        complete ? el('span', { class: 'week-check' }, '✅') : el('span', { class: 'muted small' }, `${doneCount}/${week.sessions.length}`),
      ),
    ),
    ...week.sessions
      .slice()
      .sort((a, b) => a.day - b.day)
      .map(s => sessionRow(s, week, program, ctx)),
  );
  if (isCurrent) details.open = true;
  return details;
}

const DAY_NAMES = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

function sessionRow(session, week, program, ctx) {
  const type = SESSION_TYPES[session.type] || SESSION_TYPES.ef;
  const date = sessionDate(program, week, session);
  const linked = session.activityId ? ctx.activities.find(a => a.id === session.activityId) : null;

  const row = el('div', { class: `session ${session.completed ? 'session-done' : ''}` },
    el('div', { class: 'session-head', onclick: () => body.classList.toggle('open') },
      el('span', { class: 'session-day' }, DAY_NAMES[session.day] || '?'),
      el('span', { class: 'type-pill', style: `background:${type.color}` }, type.label),
      el('div', { class: 'session-title' },
        session.title, session.optional ? el('span', { class: 'opt-chip' }, 'optionnelle') : null),
      el('span', { class: 'session-xp' }, `+${type.xp} XP`),
      el('button', {
        class: `btn-check ${session.completed ? 'checked' : ''}`,
        title: session.completed ? 'Séance validée — cliquer pour gérer' : 'Valider la séance',
        onclick: e => { e.stopPropagation(); openValidation(session, week, program, ctx); },
      }, session.completed ? '✓' : ''),
    ),
    el('div', { class: 'session-sub' },
      `${fmtDate(date)}`,
      session.estKm ? ` · ~${session.estKm} km` : '', session.estMin ? ` · ~${session.estMin} min` : '',
      linked ? el('span', { class: 'linked-chip', onclick: () => ctx.navigate('activities', { activityId: linked.id }) }, ` 🔗 ${linked.name}`) : '',
    ),
  );

  const body = el('div', { class: 'session-body' },
    el('ul', { class: 'segments' }, ...(session.segments || []).map(seg => el('li', { class: `seg seg-${seg.k}` }, segmentLabel(seg)))),
    session.notes ? el('div', { class: 'session-notes' }, `💡 ${session.notes}`) : null,
    session.completed && session.actual
      ? el('div', { class: 'session-actual' },
          `✅ Réalisé${session.completedAt ? ` le ${fmtDate(session.completedAt)}` : ''} : `
          + [session.actual.distance ? fmtKm(session.actual.distance) : null,
             session.actual.duration ? fmtDuration(session.actual.duration) : null,
             session.actual.distance && session.actual.duration ? fmtPace(paceOf(session.actual.distance, session.actual.duration)) : null,
            ].filter(Boolean).join(' · '))
      : null,
  );
  row.append(body);
  return row;
}

function segmentLabel(seg) {
  switch (seg.k) {
    case 'wu': return `Échauffement ${seg.min} min${seg.pace ? ` (${seg.pace})` : ''}`;
    case 'cd': return `Retour au calme ${seg.min} min`;
    case 'int': return `${seg.reps} × ${seg.dist} m à ${seg.pace}/km — récup ${seg.rec}`;
    case 'steady': return `${seg.label ? seg.label + ' — ' : ''}${seg.min ? seg.min + ' min' : ''}${seg.pace ? ` à ${seg.pace}${/[:\d]$/.test(seg.pace) ? '/km' : ''}` : ''}`;
    case 'strides': return `${seg.n} lignes droites (~80 m, en accélération progressive)`;
    case 'drill': return seg.label;
    case 'rest': return 'Repos complet — la récupération fait partie de l’entraînement';
    default: return JSON.stringify(seg);
  }
}

// ---------- Validation d'une séance ----------

function openValidation(session, week, program, ctx) {
  const type = SESSION_TYPES[session.type];
  const plannedDate = sessionDate(program, week, session);
  const needsActivity = !['renfo', 'repos'].includes(session.type);

  const overlay = el('div', { class: 'modal-overlay', onclick: e => { if (e.target === overlay) overlay.remove(); } });
  const modal = el('div', { class: 'modal' });
  overlay.append(modal);

  const close = () => overlay.remove();

  modal.append(
    el('div', { class: 'modal-head' },
      el('span', { class: 'type-pill', style: `background:${type.color}` }, type.label),
      el('h3', {}, session.title),
      el('button', { class: 'btn-close', onclick: close }, '×'),
    ),
    el('div', { class: 'muted small' }, `Prévue le ${fmtDate(plannedDate, { weekday: 'long', day: 'numeric', month: 'long' })} · +${type.xp} XP`),
  );

  if (session.completed) {
    modal.append(
      el('p', {}, '✅ Séance déjà validée.'),
      el('div', { class: 'modal-actions' },
        el('button', {
          class: 'btn btn-danger',
          onclick: () => {
            session.completed = false; session.completedAt = null; session.activityId = null; session.actual = null;
            persist(ctx); close(); ctx.refresh();
            toast('Validation annulée');
          },
        }, 'Annuler la validation'),
        el('button', { class: 'btn', onclick: close }, 'Fermer'),
      ),
    );
    document.body.append(overlay);
    return;
  }

  let selectedActivity = null;

  const validate = () => {
    session.completed = true;
    session.completedAt = isoDay(selectedActivity ? selectedActivity.date : new Date());
    session.activityId = selectedActivity?.id || null;
    session.actual = selectedActivity
      ? { distance: selectedActivity.distance, duration: selectedActivity.movingTime, avgHr: selectedActivity.avgHr }
      : null;
    persist(ctx);
    close();
    confetti();
    toast(`+${type.xp} XP — ${session.title} validée ! 💪`, 'success');
    ctx.refresh();
  };

  if (needsActivity) {
    // activités candidates : courses ±5 jours autour de la date prévue, non déjà liées
    const usedIds = new Set(allSessions(program).filter(s => s.activityId && s.id !== session.id).map(s => s.activityId));
    const candidates = ctx.activities
      .filter(a => ['run', 'walk', 'other'].includes(a.sport))
      .map(a => ({ a, score: matchScore(a, session, plannedDate) }))
      .filter(x => x.score > -1)
      .sort((x, y) => y.score - x.score)
      .slice(0, 12);

    const list = el('div', { class: 'match-list' });
    if (!candidates.length) {
      list.append(el('div', { class: 'muted' }, 'Aucune activité proche trouvée. Importe tes activités (Réglages) ou valide sans lien.'));
    }
    candidates.forEach(({ a, score }, i) => {
      const already = usedIds.has(a.id);
      const item = el('div', { class: `match-item ${already ? 'match-used' : ''}` },
        el('div', { class: 'match-radio' }),
        el('div', { class: 'match-info' },
          el('div', { class: 'match-name' }, a.name, i === 0 && score > 50 ? el('span', { class: 'suggest-chip' }, '⭐ suggérée') : null, already ? el('span', { class: 'opt-chip' }, 'déjà liée') : null),
          el('div', { class: 'muted small' },
            `${fmtDate(a.date, { weekday: 'short', day: 'numeric', month: 'short' })} · ${fmtKm(a.distance)} · ${fmtDuration(a.movingTime)} · ${fmtPace(paceOf(a.distance, a.movingTime))}${a.avgHr ? ` · ${a.avgHr} bpm` : ''}`),
        ),
      );
      item.addEventListener('click', () => {
        selectedActivity = selectedActivity === a ? null : a;
        list.querySelectorAll('.match-item').forEach(n => n.classList.remove('selected'));
        if (selectedActivity) item.classList.add('selected');
      });
      list.append(item);
    });

    modal.append(
      el('div', { class: 'card-title', style: 'margin-top:12px' }, '🔗 Lier à une activité'),
      list,
      el('div', { class: 'modal-actions' },
        el('button', { class: 'btn btn-ghost', onclick: validate }, 'Valider sans lien'),
        el('button', {
          class: 'btn btn-primary',
          onclick: () => { if (!selectedActivity) { toast('Sélectionne une activité, ou « Valider sans lien »', 'error'); return; } validate(); },
        }, 'Valider la séance ✓'),
      ),
    );
  } else {
    modal.append(
      el('div', { class: 'modal-actions' },
        el('button', { class: 'btn btn-primary', onclick: validate },
          session.type === 'repos' ? 'Repos respecté ✓' : 'Renfo fait ✓'),
      ),
    );
  }

  document.body.append(overlay);
}

// Score de correspondance activité <-> séance : proximité de date, distance, durée
function matchScore(a, session, plannedDate) {
  const dDays = Math.abs(new Date(a.date) - plannedDate) / 86400000;
  if (dDays > 5) return -1;
  let score = 60 - dDays * 12;
  if (session.estKm && a.distance) {
    const ratio = a.distance / 1000 / session.estKm;
    if (ratio > 0.6 && ratio < 1.5) score += 25 - Math.abs(1 - ratio) * 40;
  }
  if (session.estMin && a.movingTime) {
    const ratio = a.movingTime / 60 / session.estMin;
    if (ratio > 0.6 && ratio < 1.5) score += 15 - Math.abs(1 - ratio) * 25;
  }
  return score;
}

function persist(ctx) {
  setState('programs', ctx.programs);
}

// ---------- Import de programmes ----------

function importProgramFile(ctx) {
  const input = el('input', { type: 'file', accept: '.json,application/json' });
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const json = JSON.parse(await readFileAsText(file));
      const list = json.programs || (json.weeks ? [json] : null);
      if (!list) throw new Error('Attendu : { "programs": [...] } ou un programme seul');
      let added = 0;
      for (const p of list) {
        const errors = validateProgram(p);
        if (errors.length) throw new Error(`Programme « ${p.name || p.id} » invalide :\n– ${errors.slice(0, 5).join('\n– ')}`);
        const idx = ctx.programs.findIndex(x => x.id === p.id);
        if (idx >= 0) {
          if (!confirm(`Le programme « ${p.name} » existe déjà. Le remplacer ? (l'avancement sera perdu)`)) continue;
          ctx.programs[idx] = p;
        } else ctx.programs.push(p);
        added++;
      }
      persist(ctx);
      toast(`${added} programme(s) importé(s) 🎉`, 'success');
      ctx.refresh();
    } catch (e) {
      alert('Import impossible : ' + e.message);
    }
  });
  input.click();
}

function showFormatHelp() {
  const overlay = el('div', { class: 'modal-overlay', onclick: e => { if (e.target === overlay) overlay.remove(); } });
  const example = {
    formatVersion: 1,
    programs: [{
      id: 'mon-plan-semi', name: 'Plan semi-marathon', objective: 'Semi en 1h50',
      startDate: '2026-09-07',
      paces: { EF: '6:20', Seuil: '5:10' },
      weeks: [{
        num: 1, block: 'Bloc 1', label: 'reprise', targetKm: 30,
        sessions: [
          { id: 'w1-mar', day: 1, type: 'seuil', title: 'Seuil 3×1000 m', estKm: 7, estMin: 45,
            segments: [
              { k: 'wu', min: 15, pace: 'EF' },
              { k: 'int', reps: 3, dist: 1000, pace: '5:10', rec: '2 min trot' },
              { k: 'cd', min: 5 }] },
          { id: 'w1-dim', day: 6, type: 'sl', title: 'Sortie longue 1h10', estKm: 11, estMin: 70,
            segments: [{ k: 'steady', min: 70, pace: '6:20' }] },
        ],
      }],
    }],
  };
  overlay.append(el('div', { class: 'modal modal-wide' },
    el('div', { class: 'modal-head' }, el('h3', {}, 'Format d’import de programme'),
      el('button', { class: 'btn-close', onclick: () => overlay.remove() }, '×')),
    el('p', { class: 'small' },
      'Fichier JSON avec « programs » : liste de programmes. Chaque séance : day (0=Lun … 6=Dim), '
      + 'type (vma, seuil, spe, ef, sl, test, course, renfo, repos), segments '
      + '(wu/cd : échauffement/retour au calme · int : fractionné · steady : continu · strides : lignes droites · drill : exercice libre · rest : repos). '
      + 'Tu peux importer plusieurs programmes d’un coup — c’est le format à donner à ton coach (ou à Claude 😉) pour générer tes futurs plans.'),
    el('pre', { class: 'code-block' }, JSON.stringify(example, null, 2)),
    el('div', { class: 'modal-actions' },
      el('button', { class: 'btn', onclick: () => downloadJson(example, 'exemple-programme-runquest.json') }, '⬇️ Télécharger l’exemple'),
    ),
  ));
  document.body.append(overlay);
}
