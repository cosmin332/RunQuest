// ============================================================
// RunQuest — point d'entrée : routeur, chargement des données,
// évaluation des badges, callback OAuth Strava.
// ============================================================

import { $, el, toast, confetti } from './utils.js';
import { getActivities, getMetrics, getState, setState } from './db.js';
import { SUB50_PROGRAM } from './program-data.js';
import { evaluateBadges } from './gamification.js';
import { destroyCharts } from './charts.js';
import * as strava from './strava.js';

import { renderDashboard } from './views/dashboard.js';
import { renderProgram } from './views/program.js';
import { renderActivities } from './views/activities.js';
import { renderStats } from './views/stats.js';
import { renderProgress } from './views/progress.js';
import { renderSettings } from './views/settings.js';

const VIEWS = {
  dashboard: { render: renderDashboard, icon: '🏠', label: 'Accueil' },
  program: { render: renderProgram, icon: '🗓️', label: 'Programme' },
  activities: { render: renderActivities, icon: '👟', label: 'Activités' },
  stats: { render: renderStats, icon: '📈', label: 'Stats' },
  progress: { render: renderProgress, icon: '🏆', label: 'Progrès' },
  settings: { render: renderSettings, icon: '⚙️', label: 'Réglages' },
};

const state = {
  view: 'dashboard',
  params: {},
  activities: [],
  metrics: [],
};

function seedPrograms() {
  let programs = getState('programs', null);
  if (!programs) {
    programs = [structuredClone(SUB50_PROGRAM)];
    setState('programs', programs);
  } else if (!programs.some(p => p.id === SUB50_PROGRAM.id)) {
    programs.unshift(structuredClone(SUB50_PROGRAM));
    setState('programs', programs);
  }
  return programs;
}

async function loadData() {
  const [activities, metrics] = await Promise.all([getActivities(), getMetrics()]);
  state.activities = activities;
  state.metrics = metrics;
}

function ctx() {
  return {
    activities: state.activities,
    metrics: state.metrics,
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
    nav.append(el('button', {
      class: 'nav-btn', 'data-view': id,
      onclick: () => navigate(id),
    }, el('span', { class: 'nav-ico' }, v.icon), el('span', { class: 'nav-label' }, v.label)));
  }
}

async function init() {
  seedPrograms();
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

  await loadData();
  checkBadges();
  render();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

init();
