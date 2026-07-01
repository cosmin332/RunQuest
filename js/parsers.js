// ============================================================
// RunQuest — parseurs d'imports
//  - activities.csv de l'archive Strava (entêtes FR)
//  - fichiers .gpx individuels
//  - export JSON « Health Auto Export » (app Santé iPhone)
//  - sauvegarde de l'ancienne app runtrack
//
// Activité normalisée :
// { id, source, date (ISO), name, sport, distance (m), movingTime (s),
//   elapsedTime (s), avgHr, maxHr, cadence (spm), elevGain (m), calories,
//   effort, hrSeries [[minuteOffset, bpm], ...], gear }
// ============================================================

import { uid, isoDay } from './utils.js';

// ---------- CSV générique (guillemets, virgules imbriquées) ----------

export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// ---------- Dates françaises Strava : "1 juil. 2026, 03:45:40" (UTC) ----------

const FR_MONTHS = {
  'janv': 0, 'févr': 1, 'fevr': 1, 'mars': 2, 'avr': 3, 'mai': 4, 'juin': 5,
  'juil': 6, 'août': 7, 'aout': 7, 'sept': 8, 'oct': 9, 'nov': 10, 'déc': 11, 'dec': 11,
};

export function parseFrDate(str) {
  if (!str) return null;
  const m = String(str).match(/(\d{1,2})\s+([a-zûéè]+)\.?\s+(\d{4})[,\s]+(\d{1,2}):(\d{2}):(\d{2})/i);
  if (!m) {
    const d = new Date(str);
    return isNaN(d) ? null : d;
  }
  const month = FR_MONTHS[m[2].toLowerCase().replace('.', '').slice(0, 4)] ?? FR_MONTHS[m[2].toLowerCase().slice(0, 3)];
  if (month === undefined) return null;
  // Les dates de l'archive Strava sont en UTC
  return new Date(Date.UTC(+m[3], month, +m[1], +m[4], +m[5], +m[6]));
}

function num(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return isFinite(n) ? n : null;
}

// ---------- activities.csv (archive Strava) ----------

const SPORT_MAP = {
  'course à pied': 'run', 'run': 'run', 'course': 'run',
  'marche': 'walk', 'walk': 'walk', 'randonnée': 'hike', 'hike': 'hike',
  'vélo': 'ride', 'sortie à vélo': 'ride', 'ride': 'ride',
  'natation': 'swim', 'swim': 'swim',
  'entraînement fractionné': 'workout', 'renforcement musculaire': 'strength', 'weight training': 'strength',
};

export function normalizeSport(raw) {
  if (!raw) return 'other';
  return SPORT_MAP[String(raw).trim().toLowerCase()] || 'other';
}

export function parseStravaArchiveCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const headers = rows[0];
  // index par nom ; en cas de doublon d'entête, la DERNIÈRE occurrence est la
  // colonne détaillée (valeurs numériques précises) — c'est celle qu'on garde.
  const col = {};
  headers.forEach((h, i) => { col[h.trim()] = i; });
  const firstCol = {};
  headers.forEach((h, i) => { if (!(h.trim() in firstCol)) firstCol[h.trim()] = i; });

  const get = (row, name) => row[col[name]];
  const getFirst = (row, name) => row[firstCol[name]];

  const out = [];
  for (const row of rows.slice(1)) {
    const id = getFirst(row, "ID de l'activité");
    if (!id) continue;
    const date = parseFrDate(getFirst(row, "Date de l'activité"));
    if (!date) continue;
    const distance = num(get(row, 'Distance'));            // m (colonne détaillée)
    const movingTime = num(get(row, 'Durée de déplacement'));
    const elapsed = num(get(row, 'Temps écoulé'));
    const steps = num(get(row, 'Nombre total de pas'));
    const timeForCadence = movingTime || elapsed;
    out.push({
      id: `strava-${id}`,
      source: 'strava-archive',
      date: date.toISOString(),
      name: getFirst(row, "Nom de l'activité") || 'Activité',
      sport: normalizeSport(getFirst(row, "Type d'activité")),
      distance: distance,
      movingTime: movingTime ?? elapsed,
      elapsedTime: elapsed,
      avgHr: num(get(row, 'Fréquence cardiaque moyenne')),
      maxHr: num(get(row, 'Fréquence cardiaque max.')),
      cadence: steps && timeForCadence ? Math.round(steps / (timeForCadence / 60)) : num(get(row, 'Cadence moyenne')),
      elevGain: num(get(row, 'Dénivelé positif')),
      calories: num(get(row, 'Calories')),
      effort: num(getFirst(row, 'Effort relatif')),
      gear: get(row, "Matériel utilisé pour l'activité") || null,
      hrSeries: null,
    });
  }
  return out;
}

// ---------- GPX individuel ----------

export function parseGpx(text, filename = '') {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error(`GPX invalide : ${filename}`);
  const pts = [...doc.querySelectorAll('trkpt')];
  if (!pts.length) throw new Error(`Aucun point GPS dans ${filename}`);

  let dist = 0, prev = null;
  let hrSum = 0, hrN = 0, hrMax = null, elevGain = 0, prevEle = null;
  const hrSeries = [];
  const t0 = new Date(pts[0].querySelector('time')?.textContent);
  let tEnd = t0;

  const R = 6371000;
  for (const pt of pts) {
    const lat = parseFloat(pt.getAttribute('lat')), lon = parseFloat(pt.getAttribute('lon'));
    const time = new Date(pt.querySelector('time')?.textContent);
    if (!isNaN(time)) tEnd = time;
    if (prev) {
      const dLat = (lat - prev.lat) * Math.PI / 180, dLon = (lon - prev.lon) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(prev.lat * Math.PI / 180) * Math.cos(lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
      dist += 2 * R * Math.asin(Math.sqrt(a));
    }
    prev = { lat, lon };
    const ele = parseFloat(pt.querySelector('ele')?.textContent);
    if (!isNaN(ele)) {
      if (prevEle !== null && ele > prevEle) elevGain += ele - prevEle;
      prevEle = ele;
    }
    const hr = pt.querySelector('extensions')?.getElementsByTagName('*');
    if (hr) {
      for (const node of hr) {
        if (/(^|:)hr$/i.test(node.tagName)) {
          const bpm = parseInt(node.textContent);
          if (bpm > 0) {
            hrSum += bpm; hrN++;
            if (hrMax === null || bpm > hrMax) hrMax = bpm;
            const min = (time - t0) / 60000;
            if (!hrSeries.length || min - hrSeries[hrSeries.length - 1][0] >= 0.5) {
              hrSeries.push([Math.round(min * 10) / 10, bpm]);
            }
          }
        }
      }
    }
  }

  const name = doc.querySelector('trk > name')?.textContent || filename.replace(/\.gpx$/i, '') || 'Activité GPX';
  const typeRaw = doc.querySelector('trk > type')?.textContent || '';
  const duration = Math.max(1, (tEnd - t0) / 1000);
  const idMatch = filename.match(/(\d{6,})/);
  return {
    id: idMatch ? `strava-${idMatch[1]}` : `gpx-${uid()}`,
    source: 'gpx',
    date: t0.toISOString(),
    name,
    sport: /run|course|9$/i.test(typeRaw) ? 'run' : normalizeSport(typeRaw) || 'run',
    distance: Math.round(dist),
    movingTime: Math.round(duration),
    elapsedTime: Math.round(duration),
    avgHr: hrN ? Math.round(hrSum / hrN) : null,
    maxHr: hrMax,
    cadence: null,
    elevGain: Math.round(elevGain),
    calories: null,
    effort: null,
    gear: null,
    hrSeries: hrSeries.length ? downsample(hrSeries, 80) : null,
  };
}

function downsample(series, maxPts) {
  if (series.length <= maxPts) return series;
  const step = series.length / maxPts;
  const out = [];
  for (let i = 0; i < maxPts; i++) out.push(series[Math.floor(i * step)]);
  return out;
}

// ---------- Export « Health Auto Export » (app Santé) ----------

const HEALTH_METRICS_KEEP = new Set([
  'vo2_max', 'resting_heart_rate', 'heart_rate_variability', 'cardio_recovery',
  'weight_body_mass', 'running_power', 'running_speed', 'running_stride_length',
  'running_ground_contact_time', 'running_vertical_oscillation', 'step_count',
  'respiratory_rate', 'walking_heart_rate_average',
]);

export function parseHealthExport(json) {
  const data = json?.data;
  if (!data || (!data.workouts && !data.metrics)) {
    throw new Error('Format non reconnu (attendu : export JSON « Health Auto Export »)');
  }

  // -- Workouts --
  const activities = [];
  for (const w of data.workouts || []) {
    const start = new Date(String(w.start).replace(' +', '+').replace(' ', 'T'));
    if (isNaN(start)) continue;
    const n = w.name || '';
    const sport = /course|running|run\b/i.test(n) ? 'run'
      : /marche|walking|randonnée|hiking/i.test(n) ? 'walk'
      : /cyclisme|vélo|cycling/i.test(n) ? 'ride'
      : /natation|swim/i.test(n) ? 'swim'
      : /force|musculation|strength|poids/i.test(n) ? 'strength'
      : 'other';
    let hrSeries = null;
    if (Array.isArray(w.heartRateData) && w.heartRateData.length) {
      const t0 = start.getTime();
      hrSeries = downsample(
        w.heartRateData
          .map(h => {
            const t = new Date(String(h.date).replace(' +', '+').replace(' ', 'T'));
            const bpm = h.Avg ?? h.avg ?? h.qty;
            return isNaN(t) || !bpm ? null : [Math.round((t - t0) / 6000) / 10, Math.round(bpm)];
          })
          .filter(Boolean)
          .sort((a, b) => a[0] - b[0]),
        80
      );
      // série gardée seulement si elle couvre au moins la moitié de la séance
      // (certains exports Santé n'ont que la récup de fin, trompeur à l'affichage)
      const spanMin = hrSeries.length > 1 ? hrSeries[hrSeries.length - 1][0] - hrSeries[0][0] : 0;
      if (!hrSeries.length || (w.duration && spanMin < 0.5 * w.duration / 60)) hrSeries = null;
    }
    const kcal = w.activeEnergyBurned?.qty
      ? Math.round(w.activeEnergyBurned.units === 'kJ' ? w.activeEnergyBurned.qty / 4.184 : w.activeEnergyBurned.qty)
      : null;
    const cad = w.stepCadence?.qty
      ? Math.round(/\/s|count\/s/.test(w.stepCadence.units || '') ? w.stepCadence.qty * 60 : w.stepCadence.qty)
      : null;
    activities.push({
      id: `health-${w.id || uid()}`,
      source: 'health',
      date: start.toISOString(),
      name: w.name || 'Entraînement',
      sport,
      distance: w.distance?.qty != null ? Math.round(w.distance.qty * 1000) : null, // km -> m
      movingTime: w.duration ? Math.round(w.duration) : null,
      elapsedTime: w.duration ? Math.round(w.duration) : null,
      avgHr: w.avgHeartRate?.qty ? Math.round(w.avgHeartRate.qty) : null,
      maxHr: w.maxHeartRate?.qty ? Math.round(w.maxHeartRate.qty) : null,
      cadence: cad,
      elevGain: w.elevationUp?.qty != null ? Math.round(w.elevationUp.qty) : null,
      calories: kcal,
      effort: null,
      gear: null,
      hrSeries,
      indoor: !!w.isIndoor,
    });
  }

  // -- Métriques journalières --
  const metrics = [];
  for (const m of data.metrics || []) {
    if (m.name === 'sleep_analysis') {
      for (const d of m.data || []) {
        const day = isoDay(new Date(String(d.date).replace(' +', '+').replace(' ', 'T')));
        metrics.push({
          key: `sleep|${day}`, name: 'sleep', date: day,
          total: d.totalSleep ?? d.asleep ?? null,
          deep: d.deep ?? null, rem: d.rem ?? null, core: d.core ?? null, awake: d.awake ?? null,
        });
      }
      continue;
    }
    if (!HEALTH_METRICS_KEEP.has(m.name)) continue;
    for (const d of m.data || []) {
      if (d.qty == null) continue;
      const day = isoDay(new Date(String(d.date).replace(' +', '+').replace(' ', 'T')));
      metrics.push({ key: `${m.name}|${day}`, name: m.name, date: day, qty: d.qty, units: m.units });
    }
  }

  return { activities, metrics };
}

// ---------- Fusion / déduplication multi-sources ----------
// Deux enregistrements sont considérés comme la MÊME activité si leurs plages
// horaires se chevauchent majoritairement (double enregistrement montre/téléphone,
// ou même séance vue par Strava et par Santé avec des durées différentes).
// Des segments consécutifs sans chevauchement restent des activités distinctes.
// Priorité des sources : strava-api > strava-archive > gpx > health.

const SOURCE_PRIORITY = { 'strava-api': 4, 'strava-archive': 3, 'gpx': 2, 'health': 1 };

function sportsCompatible(a, b) {
  return a.sport === b.sport || a.sport === 'other' || b.sport === 'other';
}

function sameActivity(a, b) {
  if (!sportsCompatible(a, b)) return false;
  const startA = new Date(a.date).getTime(), startB = new Date(b.date).getTime();
  if (Math.abs(startA - startB) > 30 * 60 * 1000) return false;
  const durA = (a.movingTime || a.elapsedTime || 0) * 1000;
  const durB = (b.movingTime || b.elapsedTime || 0) * 1000;
  // durées inexploitables : on se rabat sur un départ quasi identique
  if (durA < 60000 || durB < 60000) return Math.abs(startA - startB) < 3 * 60 * 1000;
  // chevauchement des plages [début, fin] rapporté à la plus courte des deux
  const overlap = Math.min(startA + durA, startB + durB) - Math.max(startA, startB);
  if (overlap / Math.min(durA, durB) >= 0.6) return true;
  // départs quasi simultanés avec durées comparables (horodatages imprécis)
  return Math.abs(startA - startB) < 2 * 60 * 1000
    && Math.abs(durA - durB) <= 0.3 * Math.max(durA, durB);
}

function mergeInto(primary, secondary) {
  const merged = { ...primary };
  for (const k of ['distance', 'movingTime', 'elapsedTime', 'avgHr', 'maxHr', 'cadence', 'elevGain', 'calories', 'effort', 'gear', 'hrSeries']) {
    if (merged[k] == null && secondary[k] != null) merged[k] = secondary[k];
  }
  // La série FC de Santé est souvent plus riche que rien du tout
  if (!merged.hrSeries && secondary.hrSeries) merged.hrSeries = secondary.hrSeries;
  merged.mergedSources = [...new Set([...(primary.mergedSources || [primary.source]), ...(secondary.mergedSources || [secondary.source])])];
  return merged;
}

// existing : activités déjà en base ; incoming : nouvelles.
// Retourne { toSave, added, merged, remap } — toSave contient fusions et ajouts,
// remap : Map(idAbsorbé -> idConservé) pour re-lier les séances de programme.
export function mergeActivityLists(existing, incoming) {
  const result = new Map(existing.map(a => [a.id, a]));
  const remap = new Map();
  let added = 0, mergedCount = 0;

  for (const inc of incoming) {
    if (result.has(inc.id)) {
      // même id : on complète les champs manquants
      result.set(inc.id, mergeInto(result.get(inc.id), inc));
      continue;
    }
    let match = null;
    for (const ex of result.values()) {
      if (sameActivity(ex, inc)) { match = ex; break; }
    }
    if (match) {
      const pInc = SOURCE_PRIORITY[inc.source] || 0, pEx = SOURCE_PRIORITY[match.source] || 0;
      // à priorité égale (ex. deux enregistrements Strava simultanés),
      // on garde l'enregistrement le plus long — le plus complet
      let primary, secondary;
      if (pInc !== pEx) [primary, secondary] = pInc > pEx ? [inc, match] : [match, inc];
      else [primary, secondary] = (inc.movingTime || 0) > (match.movingTime || 0) ? [inc, match] : [match, inc];
      const merged = mergeInto(primary, secondary);
      if (primary.id !== match.id) {
        result.delete(match.id);
        remap.set(match.id, merged.id);
      } else {
        remap.set(secondary.id, merged.id);
      }
      result.set(merged.id, merged);
      mergedCount++;
    } else {
      result.set(inc.id, inc);
      added++;
    }
  }
  return { toSave: [...result.values()], added, merged: mergedCount, remap };
}

// Déduplique une liste déjà en base (auto-guérison après changement de règles).
// Retourne { toSave, removedIds, remap, merged }.
export function dedupeList(list) {
  // tri : sources prioritaires d'abord pour qu'elles servent de référence,
  // puis par durée décroissante (le plus complet absorbe le plus court)
  const ordered = [...list].sort((a, b) =>
    (SOURCE_PRIORITY[b.source] || 0) - (SOURCE_PRIORITY[a.source] || 0)
    || (b.movingTime || 0) - (a.movingTime || 0));
  const { toSave, merged, remap } = mergeActivityLists([], ordered);
  const kept = new Set(toSave.map(a => a.id));
  const removedIds = list.map(a => a.id).filter(id => !kept.has(id));
  return { toSave, removedIds, remap, merged };
}

// ---------- Sauvegarde de l'ancienne app runtrack ----------

function guessType(title = '') {
  const t = title.toLowerCase();
  if (/vma|fractionn|200|300|400/.test(t)) return 'vma';
  if (/seuil/.test(t)) return 'seuil';
  if (/sortie longue|\bsl\b/.test(t)) return 'sl';
  if (/test/.test(t)) return 'test';
  if (/objectif|course 10|10 ?km.*(course|objectif)/.test(t)) return 'course';
  if (/renfo|gainage|mobilit/.test(t)) return 'renfo';
  if (/repos/.test(t)) return 'repos';
  return 'ef';
}

export function parseRuntrackBackup(json) {
  if (!Array.isArray(json?.workouts)) throw new Error('Sauvegarde runtrack non reconnue (pas de « workouts »)');

  // Regroupe les séances par semaine calendaire
  const byWeek = new Map();
  for (const w of json.workouts) {
    if (!w.plannedDate) continue;
    const d = new Date(w.plannedDate + 'T12:00:00');
    const monday = new Date(d);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const key = isoDay(monday);
    if (!byWeek.has(key)) byWeek.set(key, []);
    byWeek.get(key).push({ ...w, _monday: monday, _dow: (d.getDay() + 6) % 7 });
  }

  const weekKeys = [...byWeek.keys()].sort();
  if (!weekKeys.length) throw new Error('Aucune séance datée dans la sauvegarde');

  const goal = (json.goals || [])[0];
  const program = {
    id: 'legacy-runtrack',
    name: goal?.title ? `Programme précédent — ${goal.title}` : 'Programme précédent (runtrack)',
    objective: goal?.title || 'Programme importé de runtrack',
    startDate: weekKeys[0],
    source: 'import runtrack',
    description: 'Programme importé depuis la sauvegarde de l’ancienne app runtrack, avec l’historique de validation.',
    paces: {},
    archived: true,
    weeks: weekKeys.map((wk, i) => ({
      num: i + 1,
      block: 'Historique',
      label: '',
      targetKm: null,
      sessions: byWeek.get(wk).map(w => ({
        id: `legacy-${w.id}`,
        day: w._dow,
        type: guessType(w.title),
        title: w.title || 'Séance',
        estKm: w.actualDist || null,
        estMin: w.actualDur || null,
        optional: false,
        segments: (w.segments || []).map(s => ({ k: 'drill', label: s.label || '' })),
        notes: w.notes || '',
        // état d'avancement conservé
        completed: !!w.completed,
        completedAt: w.completedAt || null,
        activityId: w.stravaId ? `strava-${w.stravaId}` : null,
        actual: w.completed ? { distance: w.actualDist ? w.actualDist * 1000 : null, duration: w.actualDur ? w.actualDur * 60 : null } : null,
      })),
    })),
  };

  const settingsPatch = {};
  if (json.strava?.clientId) settingsPatch.stravaClientId = json.strava.clientId;
  if (json.strava?.clientSecret) settingsPatch.stravaClientSecret = json.strava.clientSecret;

  return { program, settingsPatch, mobilityNotes: (json.mobility || []).map(m => ({ title: m.title, notes: m.notes })) };
}
