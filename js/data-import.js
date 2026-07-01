// ============================================================
// RunQuest — ingestion centralisée des activités.
// TOUT import (Santé, archive, GPX, API Strava, restauration) passe par ici :
// fusion avec l'existant + déduplication complète + re-liaison des séances
// de programme dont l'activité a été absorbée par une fusion.
// ============================================================

import { getActivities, saveActivities, deleteActivities, getState, setState } from './db.js';
import { mergeActivityLists, dedupeList } from './parsers.js';

// Reporte les fusions sur les séances validées : si l'activité liée a été
// absorbée, la séance pointe désormais vers l'activité conservée.
function applyRemapToPrograms(remap) {
  if (!remap.size) return 0;
  const programs = getState('programs', []);
  let changed = 0;
  for (const p of programs) {
    for (const w of p.weeks || []) {
      for (const s of w.sessions || []) {
        // suit les chaînes de fusion (a->b puis b->c)
        let hops = 0;
        while (s.activityId && remap.has(s.activityId) && hops < 10) {
          s.activityId = remap.get(s.activityId);
          changed++; hops++;
        }
      }
    }
  }
  if (changed) setState('programs', programs);
  return changed;
}

// Importe des activités normalisées. Retourne { added, merged, removed }.
export async function ingestActivities(incoming) {
  const existing = await getActivities();
  const step1 = mergeActivityLists(existing, incoming);
  // passe de déduplication complète : attrape aussi les doublons
  // préexistants et les cas dépendant de l'ordre d'insertion
  const step2 = dedupeList(step1.toSave);
  const remap = new Map([...step1.remap, ...step2.remap]);

  const keptIds = new Set(step2.toSave.map(a => a.id));
  const gone = existing.map(a => a.id).filter(id => !keptIds.has(id));

  await saveActivities(step2.toSave);
  await deleteActivities(gone);
  applyRemapToPrograms(remap);

  return {
    added: step1.added - step2.removedIds.length,
    merged: step1.merged + step2.merged,
    removed: gone.length,
  };
}

// Déduplication du stock existant (auto-guérison au démarrage ou à la demande).
// Retourne le nombre de doublons supprimés.
export async function dedupeStored() {
  const existing = await getActivities();
  const { toSave, removedIds, remap } = dedupeList(existing);
  if (!removedIds.length) return 0;
  await saveActivities(toSave);
  await deleteActivities(removedIds);
  applyRemapToPrograms(remap);
  return removedIds.length;
}
