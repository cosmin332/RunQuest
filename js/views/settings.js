// ============================================================
// RunQuest — Vue Réglages : imports, Strava API, sauvegarde, profil
// ============================================================

import { el, toast, downloadJson, readFileAsText, fmtDate, isoDay } from '../utils.js';
import { getState, setState, saveActivities, saveMetrics, exportBackup, restoreBackup, wipeAll, getActivities } from '../db.js';
import { parseStravaArchiveCsv, parseGpx, parseHealthExport, parseRuntrackBackup, mergeActivityLists } from '../parsers.js';
import * as strava from '../strava.js';

export function renderSettings(root, ctx) {
  const settings = getState('settings', {});
  const importLog = getState('importLog', {});

  // ---------- Imports ----------
  root.append(el('div', { class: 'card' },
    el('div', { class: 'card-title' }, '📥 Importer des données'),

    importRow('🍎', 'Export app Santé (iPhone)',
      'Fichier JSON « Health Auto Export » : workouts + VO₂max, FC repos, HRV, sommeil, poids, technique de course…',
      importLog.health ? `Dernier import : ${fmtDate(importLog.health)}` : null,
      () => pickFile('.json', async file => {
        const json = JSON.parse(await readFileAsText(file));
        const { activities, metrics } = parseHealthExport(json);
        const existing = await getActivities();
        const { toSave, added, merged } = mergeActivityLists(existing, activities);
        await saveActivities(toSave);
        await saveMetrics(metrics);
        setState('importLog', { ...getState('importLog', {}), health: new Date().toISOString() });
        toast(`Santé : ${added} activités ajoutées, ${merged} fusionnées, ${metrics.length} points de métriques`, 'success');
        ctx.refresh();
      })),

    importRow('🗂️', 'Archive Strava (activities.csv)',
      'Dans l’export d’archive Strava, choisis le fichier activities.csv (résumé de toutes tes activités).',
      importLog.archive ? `Dernier import : ${fmtDate(importLog.archive)}` : null,
      () => pickFile('.csv', async file => {
        const acts = parseStravaArchiveCsv(await readFileAsText(file));
        if (!acts.length) throw new Error('Aucune activité trouvée dans ce CSV');
        const existing = await getActivities();
        const { toSave, added, merged } = mergeActivityLists(existing, acts);
        await saveActivities(toSave);
        setState('importLog', { ...getState('importLog', {}), archive: new Date().toISOString() });
        toast(`Archive : ${added} ajoutées, ${merged} fusionnées`, 'success');
        ctx.refresh();
      })),

    importRow('🛰️', 'Fichiers GPX individuels',
      'Un ou plusieurs .gpx exportés de Strava ou d’une montre (avec FC si dispo).',
      null,
      () => pickFile('.gpx', async files => {
        const acts = [];
        for (const f of files) {
          try { acts.push(parseGpx(await readFileAsText(f), f.name)); }
          catch (e) { console.warn(e); }
        }
        if (!acts.length) throw new Error('Aucun GPX lisible');
        const existing = await getActivities();
        const { toSave, added, merged } = mergeActivityLists(existing, acts);
        await saveActivities(toSave);
        toast(`GPX : ${added} ajoutées, ${merged} fusionnées`, 'success');
        ctx.refresh();
      }, true)),

    importRow('🕰️', 'Sauvegarde ancienne app (runtrack)',
      'Récupère ton programme sub-50 précédent avec son historique de séances validées.',
      null,
      () => pickFile('.json', async file => {
        const json = JSON.parse(await readFileAsText(file));
        const { program, settingsPatch } = parseRuntrackBackup(json);
        const programs = getState('programs', []);
        const idx = programs.findIndex(p => p.id === program.id);
        if (idx >= 0) programs[idx] = program; else programs.push(program);
        setState('programs', programs);
        if (Object.keys(settingsPatch).length) {
          setState('settings', { ...getState('settings', {}), ...settingsPatch });
          toast('Identifiants Strava récupérés depuis la sauvegarde 👌', 'success');
        }
        toast(`Programme « ${program.name} » importé avec son historique`, 'success');
        ctx.refresh();
      })),
  ));

  // ---------- Strava API ----------
  const stravaCard = el('div', { class: 'card' },
    el('div', { class: 'card-title' }, '🔄 Synchronisation Strava (API)'),
    el('p', { class: 'small muted' },
      'Crée une app sur strava.com/settings/api (« Authorization Callback Domain » = le domaine où tourne RunQuest, ex. tonpseudo.github.io) puis colle Client ID et Client Secret ici. Tout reste sur ton appareil.'),
    labeledInput('Client ID', settings.stravaClientId || '', v => saveSetting('stravaClientId', v)),
    labeledInput('Client Secret', settings.stravaClientSecret || '', v => saveSetting('stravaClientSecret', v), 'password'),
  );

  if (strava.isConnected()) {
    const ath = strava.athlete();
    const last = strava.lastSync();
    stravaCard.append(
      el('div', { class: 'strava-status ok' }, `✅ Connecté${ath?.name ? ` — ${ath.name}` : ''}${last ? ` · dernière sync : ${fmtDate(last)}` : ''}`),
      el('div', { class: 'modal-actions' },
        el('button', {
          class: 'btn btn-primary',
          onclick: async e => {
            const btn = e.target; btn.disabled = true; btn.textContent = 'Synchronisation…';
            try {
              const acts = await strava.syncActivities();
              const existing = await getActivities();
              const { toSave, added, merged } = mergeActivityLists(existing, acts);
              await saveActivities(toSave);
              setState('importLog', { ...getState('importLog', {}), api: new Date().toISOString() });
              toast(`Strava : ${added} nouvelles activités, ${merged} fusionnées`, 'success');
              ctx.refresh();
            } catch (err) { toast(err.message, 'error', 5000); }
            finally { btn.disabled = false; btn.textContent = '🔄 Synchroniser maintenant'; }
          },
        }, '🔄 Synchroniser maintenant'),
        el('button', { class: 'btn btn-ghost', onclick: () => { strava.disconnect(); ctx.refresh(); } }, 'Déconnecter'),
      ),
    );
  } else {
    stravaCard.append(el('div', { class: 'modal-actions' },
      el('button', {
        class: 'btn btn-primary',
        onclick: () => {
          if (!strava.isConfigured()) { toast('Renseigne d’abord Client ID et Client Secret', 'error'); return; }
          strava.startAuth();
        },
      }, '🔗 Connecter mon compte Strava'),
    ));
  }
  root.append(stravaCard);

  // ---------- Profil ----------
  root.append(el('div', { class: 'card' },
    el('div', { class: 'card-title' }, '👤 Profil coureur'),
    el('p', { class: 'small muted' }, 'Utilisé pour les zones FC, la charge d’entraînement et le score de préparation.'),
    labeledInput('FC max (bpm)', settings.fcMax || 195, v => saveSetting('fcMax', parseInt(v) || 195), 'number'),
    labeledInput('FC repos (bpm)', settings.fcRepos || 55, v => saveSetting('fcRepos', parseInt(v) || 55), 'number'),
  ));

  // ---------- Sauvegarde ----------
  root.append(el('div', { class: 'card' },
    el('div', { class: 'card-title' }, '💾 Sauvegarde complète'),
    el('p', { class: 'small muted' }, 'Exporte TOUT (activités, métriques, programmes, avancement, XP, badges, réglages) dans un fichier JSON. Garde-le précieusement : il permet de tout restaurer si l’app plante ou si tu changes d’appareil.'),
    el('div', { class: 'modal-actions' },
      el('button', {
        class: 'btn btn-primary',
        onclick: async () => {
          const data = await exportBackup();
          downloadJson(data, `runquest-sauvegarde-${isoDay(new Date())}.json`);
          toast('Sauvegarde téléchargée 💾', 'success');
        },
      }, '⬇️ Exporter la sauvegarde'),
      el('button', {
        class: 'btn',
        onclick: () => pickFile('.json', async file => {
          const json = JSON.parse(await readFileAsText(file));
          if (!confirm('Restaurer cette sauvegarde ? Les données actuelles seront remplacées.')) return;
          const res = await restoreBackup(json);
          toast(`Restauré : ${res.activities} activités, ${res.metrics} métriques`, 'success');
          location.reload();
        }),
      }, '⬆️ Restaurer une sauvegarde'),
    ),
    el('details', { style: 'margin-top:10px' },
      el('summary', { class: 'small muted' }, 'Zone dangereuse'),
      el('button', {
        class: 'btn btn-danger', style: 'margin-top:8px',
        onclick: async () => {
          if (!confirm('Tout effacer ? (activités, programmes, badges, réglages)')) return;
          if (!confirm('Vraiment sûr ? Fais une sauvegarde avant !')) return;
          await wipeAll();
          location.reload();
        },
      }, '🗑️ Tout effacer'),
    ),
  ));

  root.append(el('div', { class: 'muted small center' }, 'RunQuest v1 · données 100 % locales (IndexedDB) · PWA installable : Partager → « Sur l’écran d’accueil »'));
}

function saveSetting(key, value) {
  setState('settings', { ...getState('settings', {}), [key]: value });
}

function labeledInput(label, value, onChange, type = 'text') {
  return el('label', { class: 'field' },
    el('span', {}, label),
    el('input', { class: 'input', type, value, onchange: e => onChange(e.target.value) }),
  );
}

function importRow(icon, title, desc, lastInfo, onClick) {
  return el('div', { class: 'import-row' },
    el('div', { class: 'import-ico' }, icon),
    el('div', { class: 'import-info' },
      el('div', { class: 'import-title' }, title),
      el('div', { class: 'muted small' }, desc),
      lastInfo ? el('div', { class: 'import-last small' }, `✅ ${lastInfo}`) : null,
    ),
    el('button', { class: 'btn btn-ghost', onclick: onClick }, 'Importer'),
  );
}

function pickFile(accept, handler, multiple = false) {
  const input = el('input', { type: 'file', accept });
  if (multiple) input.multiple = true;
  input.addEventListener('change', async () => {
    if (!input.files.length) return;
    try {
      await handler(multiple ? [...input.files] : input.files[0]);
    } catch (e) {
      console.error(e);
      alert('Import impossible : ' + e.message);
    }
  });
  input.click();
}
