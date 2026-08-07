// ============================================================
// RunQuest — Vue séance de musculation : saisie séries/poids/reps,
// rappel de la dernière fois, minuteur de récup auto (2 min par défaut).
// ============================================================

import { el, toast, confetti, uid, isoDay, fmtDate, fmtDuration, weekKey, mondayOf } from '../utils.js';
import { setState } from '../db.js';
import { getStrengthLogs, saveStrengthLog, deleteStrengthLog, lastForExercise, loggedSets, logTonnage, logForSessionWeek } from '../strength.js';
import { SESSION_TYPES } from '../program-data.js';
import { evaluateBadges } from '../gamification.js';

const DEFAULT_REST = 120;

function parseNum(v) {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return isFinite(n) ? n : null;
}

// Extrait un ID YouTube (11 car.) d'une URL ou d'un ID collé.
export function parseYouTube(input) {
  if (!input) return null;
  const s = String(input).trim();
  const m = s.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([A-Za-z0-9_-]{11})/) || s.match(/^([A-Za-z0-9_-]{11})$/);
  return m ? m[1] : null;
}

// Lecteur vidéo intégré (modale + iframe YouTube).
function openVideo(id, title = '') {
  const overlay = el('div', { class: 'modal-overlay video-overlay', onclick: e => { if (e.target === overlay) overlay.remove(); } });
  overlay.append(el('div', { class: 'video-modal' },
    el('div', { class: 'video-modal-head' },
      el('span', { class: 'video-modal-title' }, title || 'Démonstration'),
      el('button', { class: 'btn-close', onclick: () => overlay.remove() }, '×')),
    el('div', { class: 'video-frame' },
      el('iframe', {
        src: `https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1`,
        allow: 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture',
        allowfullscreen: 'true', frameborder: '0',
      })),
  ));
  document.body.append(overlay);
}

export function renderWorkout(root, ctx) {
  root.append(el('div', { class: 'card muted' }, 'Chargement de la séance…'));
  getStrengthLogs().then(logs => {
    root.replaceChildren();
    try { build(root, ctx, logs); }
    catch (e) { console.error(e); root.append(el('div', { class: 'card' }, el('b', {}, 'Erreur : '), String(e.message))); }
  });
}

function build(root, ctx, logs) {
  const { programId, sessionId } = ctx.params;
  const program = ctx.programs.find(p => p.id === programId) || ctx.programs.find(p => !p.archived);
  let week, session;
  for (const w of program?.weeks || []) {
    const s = w.sessions.find(x => x.id === sessionId);
    if (s) { week = w; session = s; break; }
  }
  if (!session) { root.append(el('div', { class: 'card muted' }, 'Séance introuvable.')); return; }

  const type = SESSION_TYPES[session.type] || SESSION_TYPES.muscu;
  const startedAt = Date.now();
  const recurring = !!program.recurring;

  // date de la séance : occurrence passée en paramètre (agenda / semaine en cours),
  // sinon aujourd'hui pour un programme récurrent, sinon la date planifiée.
  const targetDate = ctx.params.date
    ? new Date(ctx.params.date + 'T12:00:00')
    : new Date();
  const targetMonday = weekKey(targetDate);

  // log existant : pour un récurrent, celui de la semaine visée ; sinon via workoutId.
  const existing = recurring
    ? logForSessionWeek(logs, session.id, targetMonday)
    : (session.workoutId ? logs.find(l => l.id === session.workoutId) : null);
  const alreadyDone = recurring ? !!existing : !!session.completed;
  const model = (session.exercises || []).map((ex, i) => {
    const saved = existing?.exercises?.[i];
    const info = ex.info || (ex.sets == null && (ex.reps == null || ex.reps === ''));
    const nSets = info ? 0 : (saved?.sets?.length || ex.sets || 3);
    return {
      name: ex.name,
      targetSets: ex.sets || nSets,
      targetReps: ex.reps ?? '',
      rest: ex.rest || DEFAULT_REST,
      notes: ex.notes || '',
      rpe: ex.rpe || null,
      youtubeId: ex.youtubeId || null,
      info,
      sets: Array.from({ length: nSets }, (_, k) => ({
        weight: saved?.sets?.[k]?.weight ?? null,
        reps: saved?.sets?.[k]?.reps ?? null,
        done: saved ? true : false,
      })),
    };
  });

  const timer = createRestTimer();

  // --- Entête ---
  root.append(
    el('button', { class: 'btn btn-ghost', onclick: () => ctx.navigate('program', { programId: program.id }) }, '‹ Retour au programme'),
    el('div', { class: 'card wk-head' },
      el('div', {},
        el('span', { class: 'type-pill', style: `background:${type.color}` }, type.label),
        recurring ? el('span', { class: 'recur-chip' }, ' 🔁 chaque semaine') : null,
        el('h2', { style: 'margin-top:6px' }, session.title),
        el('div', { class: 'muted small' }, `${fmtDate(targetDate, { weekday: 'long', day: 'numeric', month: 'long' })} · ${model.length} exercice${model.length > 1 ? 's' : ''}`
          + (alreadyDone ? ' · ✅ faite' : '')),
      ),
      session.notes || session.note ? el('div', { class: 'session-notes' }, `💡 ${session.notes || session.note}`) : null,
    ),
  );

  if (!model.length) {
    root.append(el('div', { class: 'card muted' }, 'Cette séance muscu ne contient pas d’exercices. Ajoute-les dans le format d’import (voir Programme → ❓ Format).'));
  }

  // --- Cartes exercices ---
  model.forEach((ex, exIdx) => {
    const card = el('div', { class: 'card ex-card' });
    const targetTxt = ex.info ? 'circuit' : `${ex.targetSets} × ${ex.targetReps || '?'}${ex.rpe ? ` @ RPE ${ex.rpe}` : ''}`;
    card.append(
      el('div', { class: 'ex-head' },
        el('div', { class: 'ex-name' }, ex.name),
        el('div', { class: 'ex-target' }, targetTxt),
      ),
    );
    // Vidéo : lecteur intégré + lien modifiable (ou ajout si absent)
    const realEx = session.exercises[exIdx];
    const vids = el('div', { class: 'video-row' });
    const editVideo = () => {
      const cur = ex.youtubeId ? `https://youtu.be/${ex.youtubeId}` : '';
      const v = prompt('Colle le lien YouTube (ou l’ID) de la démo :', cur);
      if (v === null) return;
      if (v.trim() === '') { ex.youtubeId = null; if (realEx) realEx.youtubeId = null; }
      else {
        const id = parseYouTube(v);
        if (!id) { toast('Lien YouTube non reconnu', 'error'); return; }
        ex.youtubeId = id; if (realEx) realEx.youtubeId = id;
      }
      setState('programs', ctx.programs);
      renderVids();
      toast('Vidéo mise à jour', 'success');
    };
    const renderVids = () => {
      vids.replaceChildren();
      if (ex.youtubeId) {
        vids.append(
          el('button', { class: 'video-link', onclick: () => openVideo(ex.youtubeId, ex.name) }, '▶ Voir la démo'),
          el('button', { class: 'video-edit', title: 'Changer la vidéo', onclick: editVideo }, '✎'),
        );
      } else {
        vids.append(el('button', { class: 'video-add', onclick: editVideo }, '＋ Ajouter une vidéo'));
      }
    };
    renderVids();
    card.append(vids);

    if (ex.info) {
      // exercice « circuit / AMRAP » : pas de charges à logger, on garde la consigne
      if (ex.notes) card.append(el('div', { class: 'ex-notes' }, ex.notes));
      root.append(card);
      return;
    }

    const last = lastForExercise(logs.filter(l => l.id !== existing?.id), ex.name);
    if (last) {
      const summary = loggedSets(last.ex).map(s => `${fmtWeight(s.weight)}×${s.reps}`).join(', ');
      card.append(el('div', { class: 'last-time' }, `↩︎ Dernière fois (${fmtDate(last.date, { day: 'numeric', month: 'short' })}) : ${summary}`));
    } else {
      card.append(el('div', { class: 'last-time muted' }, 'Première fois sur cet exercice — note tes charges, elles serviront de repère.'));
    }

    const setsWrap = el('div', { class: 'sets-wrap' });
    const rebuild = () => { setsWrap.replaceChildren(); ex.sets.forEach((set, i) => setsWrap.append(setRow(ex, set, i, last, timer, rebuild))); };
    rebuild();
    card.append(
      el('div', { class: 'sets-head' }, el('span', {}, 'Série'), el('span', {}, 'Poids (kg)'), el('span', {}, 'Reps'), el('span', {}, '')),
      setsWrap,
      el('button', { class: 'btn btn-ghost small add-set', onclick: () => { ex.sets.push({ weight: ex.sets.at(-1)?.weight ?? null, reps: null, done: false }); rebuild(); } }, '+ série'),
    );
    if (ex.notes) card.append(el('details', { class: 'ex-notes-toggle' }, el('summary', {}, 'Consignes'), el('div', { class: 'ex-notes' }, ex.notes)));
    root.append(card);
  });

  // --- Terminer ---
  const finishBtn = el('button', { class: 'btn btn-primary full', style: 'margin-top:4px', onclick: () => finish() },
    alreadyDone ? 'Mettre à jour la séance' : 'Terminer la séance 💪');
  root.append(finishBtn);
  if (alreadyDone) {
    root.append(el('button', { class: 'btn btn-ghost full', style: 'margin-top:8px', onclick: () => {
      if (!confirm('Supprimer cette séance enregistrée ?')) return;
      const done = () => { setState('programs', ctx.programs); toast('Séance supprimée'); ctx.refresh(); ctx.navigate('program', { programId: program.id }); };
      if (recurring) {
        if (existing) deleteStrengthLog(existing.id).then(done); else done();
      } else {
        session.completed = false; session.completedAt = null;
        const wid = session.workoutId; session.workoutId = null;
        (wid ? deleteStrengthLog(wid) : Promise.resolve()).then(done);
      }
    } }, recurring ? 'Supprimer cette séance' : 'Annuler la validation'));
  }

  function finish() {
    const anyLogged = model.some(ex => loggedSets(ex).length);
    if (!anyLogged && !confirm('Aucune série renseignée. Valider quand même la séance ?')) return;
    timer.stop();
    // date du log : jour de l'occurrence (récurrent) sinon aujourd'hui / date conservée
    const logDate = recurring
      ? new Date(targetDate.getTime())
      : (session.completedAt ? new Date(session.completedAt + 'T12:00:00') : new Date());
    if (recurring) logDate.setHours(18, 30, 0, 0);
    const log = {
      id: (recurring ? existing?.id : session.workoutId) || uid(),
      date: logDate.toISOString(),
      programId: program.id,
      sessionId: session.id,
      title: session.title,
      durationSec: Math.round((Date.now() - startedAt) / 1000),
      exercises: model.map(ex => ({
        name: ex.name, targetSets: ex.targetSets, targetReps: ex.targetReps, rest: ex.rest,
        sets: ex.sets.map(s => ({ weight: s.weight, reps: s.reps })).filter(s => s.weight != null || s.reps != null),
      })),
    };
    saveStrengthLog(log).then(() => {
      if (!recurring) {
        session.completed = true;
        session.completedAt = isoDay(new Date(log.date));
        session.workoutId = log.id;
        setState('programs', ctx.programs);
      }
      evaluateBadges(ctx.programs, ctx.activities);
      confetti();
      toast(`Séance muscu enregistrée ! ${logTonnage(log)} kg soulevés 💪`, 'success', 4000);
      ctx.refresh();
      ctx.navigate('program', { programId: program.id });
    });
  }
}

function fmtWeight(w) {
  if (w == null) return '–';
  return Number.isInteger(w) ? String(w) : w.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}

function setRow(ex, set, i, last, timer, rebuild) {
  const lastSet = last ? loggedSets(last.ex)[i] : null;
  const wInput = el('input', {
    class: 'input set-input', type: 'text', inputmode: 'decimal',
    value: set.weight ?? '', placeholder: lastSet ? fmtWeight(lastSet.weight) : 'kg',
  });
  const rInput = el('input', {
    class: 'input set-input', type: 'text', inputmode: 'numeric',
    value: set.reps ?? '', placeholder: lastSet ? String(lastSet.reps) : 'reps',
  });
  wInput.addEventListener('input', () => { set.weight = parseNum(wInput.value); });
  rInput.addEventListener('input', () => { set.reps = parseNum(rInput.value); });

  const check = el('button', { class: `set-check ${set.done ? 'checked' : ''}` }, set.done ? '✓' : '');
  const row = el('div', { class: `set-row ${set.done ? 'set-done' : ''}` },
    el('span', { class: 'set-num' }, String(i + 1)),
    wInput, rInput, check,
  );
  check.addEventListener('click', () => {
    set.weight = parseNum(wInput.value);
    set.reps = parseNum(rInput.value);
    set.done = !set.done;
    row.classList.toggle('set-done', set.done);
    check.classList.toggle('checked', set.done);
    check.textContent = set.done ? '✓' : '';
    // minuteur de récup auto au moment où la série est validée
    if (set.done) {
      // reprend la charge sur la série suivante si vide
      const next = ex.sets[i + 1];
      if (next && next.weight == null) next.weight = set.weight;
      timer.start(ex.rest || DEFAULT_REST, `${ex.name} — série ${i + 1} faite`);
      rebuild();
    }
  });
  return row;
}

// ---------- Minuteur de récupération ----------

function createRestTimer() {
  let panel, ringFg, label, sub, iv, remaining = 0, total = 0, paused = false, audioCtx;

  function ensure() {
    if (panel) return;
    panel = el('div', { class: 'rest-timer hidden' });
    const ring = el('div', { class: 'rest-ring' });
    ringFg = el('div', { class: 'rest-ring-fill' });
    label = el('div', { class: 'rest-time' }, '2:00');
    ring.append(ringFg, label);
    sub = el('div', { class: 'rest-sub' }, '');
    const controls = el('div', { class: 'rest-controls' },
      el('button', { class: 'btn btn-ghost small', onclick: () => adjust(-15) }, '−15 s'),
      el('button', { class: 'btn btn-ghost small', id: 'rest-pause', onclick: () => togglePause() }, '⏸'),
      el('button', { class: 'btn btn-ghost small', onclick: () => adjust(15) }, '+15 s'),
      el('button', { class: 'btn btn-primary small', onclick: () => stop() }, 'Passer'),
    );
    panel.append(sub, ring, controls);
    document.body.append(panel);
  }

  function render() {
    const m = Math.floor(remaining / 60), s = remaining % 60;
    label.textContent = `${m}:${String(s).padStart(2, '0')}`;
    const pct = total ? (1 - remaining / total) * 360 : 0;
    ringFg.style.background = `conic-gradient(var(--muscu, #5e60ce) ${pct}deg, #e9edf5 ${pct}deg)`;
  }

  function tick() {
    if (paused) return;
    remaining--;
    if (remaining <= 0) { render(); done(); return; }
    render();
  }

  function beep() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      for (let k = 0; k < 3; k++) {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.frequency.value = 880; o.connect(g); g.connect(audioCtx.destination);
        const t0 = audioCtx.currentTime + k * 0.25;
        g.gain.setValueAtTime(0.001, t0);
        g.gain.exponentialRampToValueAtTime(0.3, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);
        o.start(t0); o.stop(t0 + 0.22);
      }
    } catch { /* audio indispo */ }
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  }

  function done() {
    clearInterval(iv); iv = null;
    beep();
    sub.textContent = 'Récup terminée — au boulot ! 💪';
    panel.classList.add('rest-done');
    setTimeout(() => { if (panel && !iv) hide(); }, 4000);
  }

  function hide() { panel?.classList.add('hidden'); panel?.classList.remove('rest-done'); }

  function start(sec, subtitle = '') {
    ensure();
    clearInterval(iv);
    total = sec; remaining = sec; paused = false;
    sub.textContent = subtitle || 'Récupération';
    panel.classList.remove('hidden', 'rest-done');
    document.getElementById('rest-pause').textContent = '⏸';
    render();
    iv = setInterval(tick, 1000);
  }
  function adjust(d) { remaining = Math.max(1, remaining + d); total = Math.max(total, remaining); render(); }
  function togglePause() { paused = !paused; document.getElementById('rest-pause').textContent = paused ? '▶' : '⏸'; }
  function stop() { clearInterval(iv); iv = null; hide(); }

  return { start, stop };
}
