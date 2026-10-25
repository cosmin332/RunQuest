// ============================================================
// RunQuest — synchronisation Garmin via ton proxy Cloudflare personnel.
// Reprend la logique de RunLab : appelle les endpoints Garmin à travers le
// Worker (qui ajoute le token + le CORS), puis mappe la réponse vers le
// modèle de données de RunQuest (activités + métriques santé/technique).
// Ta clé Garmin reste dans le proxy ; seul le « code secret » transite.
// 100 % dans le navigateur.
// ============================================================

import { getState } from './db.js';

// ---------- Config (stockée dans settings) ----------

export function getConfig() {
  const s = getState('settings', {});
  return {
    base: (s.garminProxy || '').trim(),
    secret: (s.garminSecret || '').trim(),
    days: s.garminDays || 365,
  };
}

export function isConfigured() {
  const c = getConfig();
  return !!c.base && !!c.secret;
}

export function lastSync() {
  return getState('importLog', {}).garmin || null;
}

// ---------- Récupération (porté de RunLab garmin-sync.js) ----------

const pick = (d, keys, def) => { if (!d || typeof d !== 'object') return def; for (const k of keys) if (d[k] != null) return d[k]; return def; };
function asList(v, inner) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') { if (inner && Array.isArray(v[inner])) return v[inner]; for (const k in v) if (Array.isArray(v[k])) return v[k]; }
  return [];
}
const isoD = d => d.toISOString().slice(0, 10);
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
const rnd = (v, nd) => v == null ? null : (nd != null ? Math.round(v * 10 ** nd) / 10 ** nd : Math.round(v));
function normType(t) { t = (t || '').toLowerCase(); if (t.includes('run')) return 'running'; if (t.includes('walk')) return 'walking'; if (t.includes('hik')) return 'hiking'; if (t.includes('cycl') || t.includes('bik')) return 'cycling'; if (t.includes('swim')) return 'swimming'; if (t.includes('strength')) return 'strength_training'; return t || 'other'; }
const strideM = v => v == null ? null : (v > 3 ? Math.round(v) / 100 : Math.round(v * 100) / 100);

function convertActivity(a, detail) {
  let src = Object.assign({}, a);
  if (detail && typeof detail === 'object') {
    const sum = detail.summaryDTO || detail;
    src = Object.assign({}, src, sum);
    const at = detail.activityTypeDTO;
    if (at && at.typeKey && !src.activityType) src.activityType = { typeKey: at.typeKey };
  }
  let tkey = '';
  const at = src.activityType;
  if (at && typeof at === 'object') tkey = at.typeKey || '';
  else if (typeof at === 'string') tkey = at;
  const atype = normType(tkey);
  const distM = pick(src, ['distance'], 0) || 0;
  const durS = pick(src, ['duration', 'elapsedDuration'], 0) || 0;
  const movS = pick(src, ['movingDuration'], 0) || durS;
  const km = distM / 1000;
  const pace = km > 0 && movS > 0 ? Math.round(movS / km) : null;
  const gapSpeed = pick(src, ['avgGradeAdjustedSpeed']);
  const act = {
    id: pick(src, ['activityId', 'id']),
    name: pick(src, ['activityName', 'name'], 'Sans titre'),
    type: atype,
    start: pick(src, ['startTimeLocal']),
    distance_km: Math.round(km * 1000) / 1000,
    duration_s: rnd(durS), moving_s: rnd(movS),
    avg_pace_s_per_km: pace,
    gap_pace_s_per_km: gapSpeed ? Math.round(1000 / gapSpeed) : null,
    avg_hr: rnd(pick(src, ['averageHR', 'avgHr'])),
    max_hr: rnd(pick(src, ['maxHR', 'maxHr'])),
    avg_cadence: rnd(pick(src, ['averageRunningCadenceInStepsPerMinute', 'averageRunCadence', 'avgRunCadence', 'avgDoubleCadence'])),
    max_cadence: rnd(pick(src, ['maxRunningCadenceInStepsPerMinute', 'maxRunCadence', 'maxDoubleCadence'])),
    avg_stride_m: strideM(pick(src, ['avgStrideLength', 'averageStrideLength'])),
    avg_gct_ms: rnd(pick(src, ['avgGroundContactTime', 'groundContactTime'])),
    avg_vosc_cm: rnd(pick(src, ['avgVerticalOscillation', 'verticalOscillation']), 1),
    avg_vratio: rnd(pick(src, ['avgVerticalRatio', 'verticalRatio']), 1),
    avg_power: rnd(pick(src, ['avgPower', 'averagePower'])),
    max_power: rnd(pick(src, ['maxPower'])),
    norm_power: rnd(pick(src, ['normPower', 'normalizedPower'])),
    elevation_gain_m: rnd(pick(src, ['elevationGain'], 0) || 0),
    calories: rnd(pick(src, ['calories'])),
    aerobic_te: rnd(pick(src, ['aerobicTrainingEffect']), 1),
    anaerobic_te: rnd(pick(src, ['anaerobicTrainingEffect']), 1),
    te_label: pick(src, ['trainingEffectLabel']),
    training_load: rnd(pick(src, ['activityTrainingLoad'])),
    vo2max: rnd(pick(src, ['vO2MaxValue'])),
    steps: rnd(pick(src, ['steps'])),
  };
  const zones = detail && detail.hrTimeInZones;
  if (Array.isArray(zones)) {
    const z = [];
    zones.forEach(it => { const s = pick(it, ['secsInZone', 'seconds']); const zn = pick(it, ['zoneNumber', 'zone']); if (s && zn) z.push({ zone: +zn, seconds: Math.round(s) }); });
    if (z.length) act.hr_zones = z;
  }
  const out = {}; for (const k in act) if (act[k] != null) out[k] = act[k];
  return out;
}

// Récupère tout depuis le proxy. Retourne l'objet RunLab { profile, activities, daily, series }.
export async function fetchGarmin(cfg, onProgress) {
  const base = cfg.base.replace(/\/+$/, '');
  const prog = (m, p) => { try { onProgress && onProgress(m, p); } catch (e) {} };
  const diag = []; // trace par endpoint pour le diagnostic affiché dans Réglages
  function buildUrl(path, params) {
    const u = new URL(base + '/garmin' + path);
    if (params) for (const k in params) if (params[k] != null) u.searchParams.set(k, params[k]);
    if (cfg.secret) u.searchParams.set('s', cfg.secret);
    return u.toString();
  }
  async function api(path, params) {
    const r = await fetch(buildUrl(path, params), { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(path.split('?')[0] + ' → HTTP ' + r.status);
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  }
  // Variante instrumentée : ne jette pas ; enregistre statut, nb de lignes,
  // champs de la 1re ligne (si 200) ou extrait du corps d'erreur (si ≠ 200).
  async function apiTry(label, path, params) {
    try {
      const r = await fetch(buildUrl(path, params), { headers: { Accept: 'application/json' } });
      const t = await r.text();
      let body = null; try { body = t ? JSON.parse(t) : null; } catch (e) {}
      if (!r.ok) {
        diag.push(`${label} : HTTP ${r.status} ⚠️ ${String(t).replace(/\s+/g, ' ').slice(0, 110)}`);
        return null;
      }
      const arr = asList(body);
      const first = arr.length ? arr[0] : body;
      const keys = first && typeof first === 'object' ? Object.keys(first).slice(0, 14).join(',') : '';
      diag.push(`${label} : HTTP 200 · ${arr.length} ligne${arr.length > 1 ? 's' : ''}${keys ? ` · champs: ${keys}` : ''}`);
      return body;
    } catch (e) {
      diag.push(`${label} : échec réseau (${e.message})`);
      return null;
    }
  }

  const days = cfg.days || 400, wdays = Math.min(cfg.days || 400, 180);
  const start = isoD(daysAgo(days)), end = isoD(new Date());

  prog('Récupération des activités…', 5);
  let rawActs = [], offset = 0;
  while (true) {
    const batch = asList(await api('/activitylist-service/activities/search/activities',
      { start: offset, limit: 50, startDate: start, endDate: end }), 'activities');
    if (!batch.length) break;
    rawActs = rawActs.concat(batch); offset += batch.length;
    if (batch.length < 50 || offset > 2000) break;
  }

  const activities = []; let detailed = 0, detailOk = 0, runVo2 = 0; const DETAIL = 60;
  for (let i = 0; i < rawActs.length; i++) {
    const a = rawActs[i];
    let tkey = ''; const at = a.activityType; if (at && typeof at === 'object') tkey = (at.typeKey || '').toLowerCase();
    let detail = null;
    if (tkey.includes('run') && detailed < DETAIL) {
      detailed++;
      try { detail = await api('/activity-service/activity/' + pick(a, ['activityId', 'id'])); if (detail) detailOk++; } catch (e) {}
      prog('Détail des courses… (' + detailed + ')', 10 + Math.round(detailed / Math.max(1, rawActs.length) * 40));
    }
    const conv = convertActivity(a, detail);
    if (conv.vo2max) runVo2++;
    activities.push(conv);
  }
  activities.sort((x, y) => (x.start || '') < (y.start || '') ? -1 : 1);
  const runs = activities.filter(a => a.type === 'running');
  diag.push(`Activités : ${rawActs.length} (détails course ${detailOk}/${detailed} OK, dont VO₂max ${runVo2})`);

  prog('Sommeil, HRV, stress, FC repos…', 55);
  const ws = isoD(daysAgo(wdays)), we = isoD(new Date());
  const daily = {};
  const merge = (rows, fn) => asList(rows).forEach(r => { if (!r || typeof r !== 'object') return; let d = pick(r, ['calendarDate', 'calendar_date', 'date']); if (!d) return; d = String(d).slice(0, 10); const row = daily[d] || (daily[d] = { date: d }); fn(r, row); });

  const dailyResp = await apiTry('Résumés quotidiens (FC repos)', '/usersummary-service/v2/dailysummaries', { startDate: ws, endDate: we });
  if (dailyResp) merge(dailyResp, (r, row) => { row.resting_hr = pick(r, ['restingHeartRate']); row.steps = pick(r, ['totalSteps', 'steps']); });
  const stressResp = await apiTry('Stress', '/usersummary-service/stats/stress/daily/' + ws + '/' + we);
  if (stressResp) merge(stressResp, (r, row) => { row.stress_avg = pick(r, ['averageStressLevel', 'overallStressLevel', 'value']); });
  const sleepResp = await apiTry('Sommeil', '/sleep-service/sleep/dailySleepSummariesByDate', { startDate: ws, endDate: we });
  if (sleepResp) merge(sleepResp, (r, row) => {
    const deep = pick(r, ['deepSleepSeconds'], 0) || 0, light = pick(r, ['lightSleepSeconds'], 0) || 0, rem = pick(r, ['remSleepSeconds'], 0) || 0;
    row.sleep_s = (deep + light + rem) || pick(r, ['sleepTimeSeconds']); row.deep_s = deep || null; row.light_s = light || null; row.rem_s = rem || null; row.awake_s = pick(r, ['awakeSleepSeconds']);
    const sc = pick(r, ['sleepScores']); row.sleep_score = (sc && typeof sc === 'object') ? pick(sc, ['overallScore']) : pick(r, ['sleepScore', 'overallSleepScore']);
  });
  const hrvArr = [];
  const hrvResp = await apiTry('HRV', '/hrv-service/hrv/daily/' + ws + '/' + we);
  if (hrvResp) asList(hrvResp).forEach(r => { const d = pick(r, ['calendarDate', 'date']); const v = pick(r, ['weeklyAvg', 'lastNightAvg', 'hrvValue', 'avgHrv', 'value']); if (d && v) hrvArr.push({ date: String(d).slice(0, 10), value: Math.round(v) }); });

  // VO₂max : endpoint dédié (l'API Personal ne la met pas dans le détail d'activité)
  prog('VO₂max…', 80);
  const vo = {};
  runs.forEach(a => { if (a.vo2max && a.start) { const d = a.start.slice(0, 10); if (vo[d] == null) vo[d] = a.vo2max; } });
  const maxmetResp = await apiTry('VO₂max (maxmet)', '/metrics-service/metrics/maxmet/daily/' + ws + '/' + we);
  if (maxmetResp) asList(maxmetResp).forEach(r => {
    const d = pick(r, ['calendarDate', 'date']);
    const g = r.generic || r.running || r;
    const v = pick(g, ['vo2MaxValue', 'vo2MaxPreciseValue', 'value']);
    if (d && v) vo[String(d).slice(0, 10)] = Math.round(v);
  });

  let dailyRows = Object.values(daily).map(r => { const o = {}; for (const k in r) if (r[k] != null) o[k] = r[k]; return o; }).filter(r => Object.keys(r).length > 1);
  dailyRows.sort((a, b) => a.date < b.date ? 1 : -1);

  prog('Progression…', 90);
  const series = {};
  if (hrvArr.length) { const m = {}; hrvArr.forEach(x => m[x.date] = x); series.hrv = Object.values(m).sort((a, b) => a.date < b.date ? -1 : 1); }
  if (Object.keys(vo).length) series.vo2max = Object.keys(vo).sort().map(d => ({ date: d, value: vo[d] }));
  diag.push(`FC repos : ${dailyRows.filter(r => r.resting_hr != null).length} j · Sommeil : ${dailyRows.filter(r => r.sleep_s != null).length} nuits · HRV : ${hrvArr.length} · VO₂max : ${Object.keys(vo).length}`);

  prog('Terminé ✓', 100);
  return { generated_at: new Date().toISOString().slice(0, 19), source: 'garmin-personal-api', activities, daily: dailyRows, series, diag };
}

// ---------- Mapping vers le modèle RunQuest ----------

const SPORT = { running: 'run', walking: 'walk', hiking: 'walk', cycling: 'ride', swimming: 'swim', strength_training: 'strength' };

// "2026-04-15 18:04:00" (heure locale de la montre) → ISO UTC, aligné sur le
// format des autres sources pour que la déduplication fonctionne.
function startToIso(s) {
  if (!s) return null;
  const d = new Date(String(s).replace(' ', 'T'));
  return isNaN(d) ? null : d.toISOString();
}

// Transforme la réponse Garmin en { activities, metrics } prêts pour l'ingestion.
export function mapToRunQuest(data) {
  const activities = [];
  for (const a of data.activities || []) {
    const date = startToIso(a.start);
    if (!date || a.id == null) continue;
    const dist = a.distance_km != null ? Math.round(a.distance_km * 1000) : null;
    const mov = a.moving_s ?? a.duration_s ?? null;
    activities.push({
      id: `garmin-${a.id}`,
      source: 'garmin',
      date,
      name: a.name || 'Activité Garmin',
      sport: SPORT[a.type] || 'other',
      distance: dist,
      movingTime: mov,
      elapsedTime: a.duration_s ?? mov,
      avgHr: a.avg_hr ?? null,
      maxHr: a.max_hr ?? null,
      cadence: a.avg_cadence ?? null,
      elevGain: a.elevation_gain_m ?? null,
      calories: a.calories ?? null,
      effort: null, // la charge Garmin (training_load) n'est pas une « relative effort » : on laisse le calcul FC faire foi
      gear: null,
      hrSeries: null,
    });
  }

  // Métriques journalières (clé = `${name}|${jour}`, même format que l'import Santé).
  const metricsMap = new Map();
  const put = (name, day, obj) => { if (day) metricsMap.set(`${name}|${day}`, { key: `${name}|${day}`, name, date: day, ...obj }); };

  // Séries VO₂max & HRV
  for (const p of data.series?.vo2max || []) if (p.value != null) put('vo2_max', p.date, { qty: p.value, units: 'ml/kg/min' });
  for (const p of data.series?.hrv || []) if (p.value != null) put('heart_rate_variability', p.date, { qty: p.value, units: 'ms' });

  // Bien-être journalier : FC repos + sommeil (secondes → heures)
  for (const r of data.daily || []) {
    if (r.resting_hr != null) put('resting_heart_rate', r.date, { qty: r.resting_hr, units: 'bpm' });
    if (r.sleep_s || r.deep_s || r.rem_s || r.light_s) {
      const h = s => s != null ? Math.round(s / 360) / 10 : null; // s → h, 1 décimale
      put('sleep', r.date, { total: h(r.sleep_s), deep: h(r.deep_s), rem: h(r.rem_s), core: h(r.light_s), awake: h(r.awake_s) });
    }
  }

  // Technique de course depuis les dynamiques des courses (dernière course du jour l'emporte).
  const runs = (data.activities || []).filter(a => a.type === 'running' && a.start).sort((a, b) => a.start < b.start ? -1 : 1);
  for (const a of runs) {
    const day = a.start.slice(0, 10);
    if (a.avg_gct_ms != null) put('running_ground_contact_time', day, { qty: a.avg_gct_ms, units: 'ms' });
    if (a.avg_vosc_cm != null) put('running_vertical_oscillation', day, { qty: a.avg_vosc_cm, units: 'cm' });
    if (a.avg_stride_m != null) put('running_stride_length', day, { qty: a.avg_stride_m, units: 'm' });
    if (a.avg_power != null) put('running_power', day, { qty: a.avg_power, units: 'W' });
    if (a.distance_km && a.moving_s) put('running_speed', day, { qty: Math.round(a.distance_km / (a.moving_s / 3600) * 10) / 10, units: 'km/h' });
  }

  return { activities, metrics: [...metricsMap.values()] };
}
