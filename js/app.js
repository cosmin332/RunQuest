// ============================================================
// RunQuest — point d'entrée : routeur, chargement des données,
// évaluation des badges, callback OAuth Strava.
// ============================================================

import { $, el, toast, confetti, isoDay, mondayOf } from './utils.js';
import { getActivities, getMetrics, getState, setState, getStrengthLogs, saveStrengthLog } from './db.js';
import { SUB50_PROGRAM } from './program-data.js';
import { MUSCU_PROGRAMS, MUSCU_SEED_LOGS } from './muscu-seed.js';
import { evaluateBadges } from './gamification.js';
import { destroyCharts } from './charts.js';
import { dedupeStored } from './data-import.js';
import * as strava from './strava.js';

import { renderDashboard } from './views/dashboard.js';
import { renderProgram } from './views/program.js';
import { renderActivities } from './views/activities.js';
import { renderStats } from './views/stats.js';
import { renderProgress } from './views/progress.js';
import { renderSettings } from './views/settings.js';
import { renderAgenda } from './views/agenda.js';
import { renderWorkout } from './views/workout.js';

const VIEWS = {
  dashboard: { render: renderDashboard, icon: '🏠', label: 'Accueil' },
  agenda: { render: renderAgenda, icon: '📅', label: 'Agenda' },
  program: { render: renderProgram, icon: '🗓️', label: 'Programme' },
  activities: { render: renderActivities, icon: '👟', label: 'Activités' },
  stats: { render: renderStats, icon: '📈', label: 'Stats' },
  progress: { render: renderProgress, icon: '🏆', label: 'Progrès' },
  settings: { render: renderSettings, icon: '⚙️', label: 'Réglages' },
  workout: { render: renderWorkout, icon: '🏋️', label: 'Séance', hidden: true },
};

const state = {
  view: 'dashboard',
  params: {},
  activities: [],
  metrics: [],
};

function seedPrograms() {
  // Ne sème le plan intégré qu'au tout premier lancement (aucune donnée).
  // Ensuite on respecte les choix de l'utilisateur : s'il supprime un programme,
  // il ne doit pas réapparaître.
  let programs = getState('programs', null);
  if (programs === null) {
    programs = [structuredClone(SUB50_PROGRAM)];
    setState('programs', programs);
  }
  return programs;
}

// Insertion « de base » (une seule fois) des programmes muscu importés + de leur
// historique. Un flag évite qu'ils reviennent après suppression.
async function seedMuscuOnce() {
  if (getState('muscuSeeded')) return;
  const programs = getState('programs', []);
  const monday = isoDay(mondayOf(new Date()));
  for (const mp of MUSCU_PROGRAMS) {
    if (!programs.some(p => p.id === mp.id)) {
      const clone = structuredClone(mp);
      clone.startDate = monday; // template hebdo → cale sur la semaine en cours
      programs.push(clone);
    }
  }
  setState('programs', programs);
  try {
    const existing = new Set((await getStrengthLogs()).map(l => l.id));
    for (const log of MUSCU_SEED_LOGS) if (!existing.has(log.id)) await saveStrengthLog(log);
  } catch (e) { console.warn('seed logs muscu :', e); }
  setState('muscuSeeded', true);
}

async function loadData() {
  const [activities, metrics, strengthLogs] = await Promise.all([getActivities(), getMetrics(), getStrengthLogs()]);
  state.activities = activities;
  state.metrics = metrics;
  state.strengthLogs = strengthLogs;
}

function ctx() {
  return {
    activities: state.activities,
    metrics: state.metrics,
    strengthLogs: state.strengthLogs || [],
    programs: getState('programs', []),
    settings: getState('settings', {}),
    params: state.params,
    navigate,
    refresh,
  };
}

function navigate(view, params = {}) {
  state.view = view;
  state.params = params;
  render();
  window.scrollTo({ top: 0 });
}

async function refresh() {
  await loadData();
  checkBadges();
  render();
}

function checkBadges() {
  const fresh = evaluateBadges(getState('programs', []), state.activities);
  for (const b of fresh) {
    confetti(2200);
    toast(`🎖️ Badge débloqué : ${b.icon} ${b.name} (+25 XP)`, 'success', 4500);
  }
}

function render() {
  destroyCharts();
  const main = $('#main');
  main.replaceChildren();
  const view = VIEWS[state.view] || VIEWS.dashboard;
  try {
    view.render(main, ctx());
  } catch (e) {
    console.error(e);
    main.append(el('div', { class: 'card' },
      el('b', {}, 'Oups, une erreur dans cette vue.'),
      el('pre', { class: 'code-block small' }, String(e.stack || e)),
    ));
  }
  // nav active
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === state.view));
}

function buildNav() {
  const nav = $('#nav');
  for (const [id, v] of Object.entries(VIEWS)) {
    if (v.hidden) continue;
    nav.append(el('button', {
      class: 'nav-btn', 'data-view': id,
      onclick: () => navigate(id),
    }, el('span', { class: 'nav-ico' }, v.icon), el('span', { class: 'nav-label' }, v.label)));
  }
}

// Migration : garantit le flag `recurring` sur les programmes muscu connus,
// même s'ils ont été semés avant l'introduction de la récurrence.
function migrateMuscuRecurring() {
  const programs = getState('programs', []);
  const ids = new Set(MUSCU_PROGRAMS.map(m => m.id));
  let changed = false;
  for (const p of programs) if (ids.has(p.id) && !p.recurring) { p.recurring = true; changed = true; }
  if (changed) setState('programs', programs);
}

async function init() {
  seedPrograms();
  await seedMuscuOnce();
  migrateMuscuRecurring();
  buildNav();

  // Callback OAuth Strava (?code=...)
  if (new URLSearchParams(location.search).has('code')) {
    try {
      await strava.handleAuthCallback();
      toast('Strava connecté ! 🎉 Lance une synchronisation dans Réglages.', 'success', 5000);
      state.view = 'settings';
    } catch (e) {
      toast('Connexion Strava échouée : ' + e.message, 'error', 6000);
    }
  }

  // auto-guérison : supprime les doublons d'activités qui auraient pu
  // s'accumuler (imports multiples, anciennes règles de fusion)
  try {
    const removed = await dedupeStored();
    if (removed) toast(`🧹 ${removed} doublon${removed > 1 ? 's' : ''} d'activités nettoyé${removed > 1 ? 's' : ''}`, 'success');
  } catch (e) { console.warn('dédup au démarrage :', e); }

  await loadData();
  checkBadges();
  render();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // Mise à jour automatique : quand une nouvelle version prend le contrôle,
    // on recharge pour servir le nouveau code (sinon la PWA installée reste
    // bloquée sur l'ancienne version en cache).
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      location.reload();
    });
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(reg => {
      reg.update().catch(() => {});
      // revérifie régulièrement tant que l'app reste ouverte
      setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
    }).catch(() => {});
  }
}

init();
