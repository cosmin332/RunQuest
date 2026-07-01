// ============================================================
// RunQuest — moteur d'analyse
// Toutes les fonctions prennent des activités normalisées (voir parsers.js),
// triées ou non — elles se chargent du tri.
// ============================================================

import { weekKey, mondayOf, addDays, isoDay, mean, sum, paceOf, clamp, linearTrend } from './utils.js';

// Courses plausibles uniquement : élimine les enregistrements corrompus
// (ex. workout Santé avec 11 km en 7 min) via une allure entre 2:30 et 15:00/km.
export const runsOnly = acts => acts.filter(a => {
  if (a.sport !== 'run' || !(a.distance > 400) || !((a.movingTime || 0) > 240)) return false;
  const pace = paceOf(a.distance, a.movingTime);
  return pace != null && pace >= 150 && pace <= 900;
});

// ---------- Volume hebdomadaire ----------
// Retourne [{ week: '2026-06-29', km, count, durationH, load }] trié croissant, semaines vides incluses.

export function weeklyVolume(acts, nWeeks = 26) {
  const runs = runsOnly(acts);
  if (!runs.length) return [];
  const byWeek = new Map();
  for (const a of runs) {
    const k = weekKey(a.date);
    if (!byWeek.has(k)) byWeek.set(k, { km: 0, count: 0, durationH: 0, load: 0 });
    const w = byWeek.get(k);
    w.km += (a.distance || 0) / 1000;
    w.count++;
    w.durationH += (a.movingTime || 0) / 3600;
    w.load += trainingLoad(a);
  }
  const lastMonday = mondayOf(new Date());
  const out = [];
  for (let i = nWeeks - 1; i >= 0; i--) {
    const monday = addDays(lastMonday, -7 * i);
    const k = isoDay(monday);
    out.push({ week: k, ...(byWeek.get(k) || { km: 0, count: 0, durationH: 0, load: 0 }) });
  }
  return out;
}

// Charge d'une séance : TRIMP simplifié = durée(min) × facteur d'intensité FC.
// Sans FC : distance en km × 6 (approximation footing).
export function trainingLoad(a, fcMax = 195, fcRepos = 55) {
  const min = (a.movingTime || 0) / 60;
  if (a.avgHr && min) {
    const hrr = clamp((a.avgHr - fcRepos) / (fcMax - fcRepos), 0.2, 1);
    return Math.round(min * hrr * 1.92 * Math.exp(1.92 * hrr) / 3);
  }
  if (a.effort) return a.effort * 10;
  return Math.round((a.distance || 0) / 1000 * 6);
}

// ---------- ACWR : ratio charge aiguë (7 j) / chronique (28 j) ----------
// Retourne [{ date, acute, chronic, ratio }] par jour sur nDays.

export function acwrSeries(acts, nDays = 90, fcMax = 195, fcRepos = 55) {
  const runs = runsOnly(acts);
  const dailyLoad = new Map();
  for (const a of runs) {
    const d = isoDay(a.date);
    dailyLoad.set(d, (dailyLoad.get(d) || 0) + trainingLoad(a, fcMax, fcRepos));
  }
  const out = [];
  const today = new Date();
  for (let i = nDays - 1; i >= 0; i--) {
    const day = addDays(today, -i);
    let acute = 0, chronic = 0;
    for (let j = 0; j < 28; j++) {
      const l = dailyLoad.get(isoDay(addDays(day, -j))) || 0;
      chronic += l;
      if (j < 7) acute += l;
    }
    chronic /= 4; // moyenne hebdo sur 4 semaines
    out.push({ date: isoDay(day), acute, chronic: Math.round(chronic), ratio: chronic > 5 ? +(acute / chronic).toFixed(2) : null });
  }
  return out;
}

// ---------- Records par tranche de distance ----------

const DIST_BUCKETS = [
  { key: '1k+', min: 1000, max: 3000, label: '1–3 km' },
  { key: '3k+', min: 3000, max: 5000, label: '3–5 km' },
  { key: '5k+', min: 5000, max: 8000, label: '5–8 km' },
  { key: '8k+', min: 8000, max: 12000, label: '8–12 km' },
  { key: '12k+', min: 12000, max: 1e9, label: '12 km et +' },
];

export function records(acts) {
  const runs = runsOnly(acts);
  return DIST_BUCKETS.map(b => {
    const inBucket = runs.filter(a => a.distance >= b.min && a.distance < b.max && a.movingTime);
    if (!inBucket.length) return { ...b, best: null };
    const best = inBucket.reduce((x, y) => (paceOf(x.distance, x.movingTime) < paceOf(y.distance, y.movingTime) ? x : y));
    const recent = inBucket
      .filter(a => new Date(a.date) > addDays(new Date(), -60))
      .sort((x, y) => paceOf(x.distance, x.movingTime) - paceOf(y.distance, y.movingTime))[0] || null;
    return { ...b, best, recent, count: inBucket.length };
  });
}

// ---------- Prédictions ----------

// Riegel : T2 = T1 × (D2/D1)^1.06
export function riegel(t1Sec, d1M, d2M) {
  return t1Sec * Math.pow(d2M / d1M, 1.06);
}

// Meilleure prédiction 10 km : à partir des meilleurs efforts récents (90 j) ≥ 3 km.
export function predict10k(acts) {
  const runs = runsOnly(acts).filter(a => a.distance >= 3000 && new Date(a.date) > addDays(new Date(), -90));
  if (!runs.length) return null;
  const preds = runs.map(a => ({
    activity: a,
    predicted: riegel(a.movingTime, a.distance, 10000),
  }));
  preds.sort((a, b) => a.predicted - b.predicted);
  return preds[0];
}

// VDOT (approximation Daniels) depuis une perf
export function vdot(distM, timeSec) {
  const tMin = timeSec / 60;
  const v = distM / tMin; // m/min
  const vo2 = -4.6 + 0.182258 * v + 0.000104 * v * v;
  const pct = 0.8 + 0.1894393 * Math.exp(-0.012778 * tMin) + 0.2989558 * Math.exp(-0.1932605 * tMin);
  return +(vo2 / pct).toFixed(1);
}

// ---------- Zones FC (5 zones % FCmax) ----------

export function hrZones(fcMax = 195) {
  return [
    { z: 1, label: 'Z1 Récup', lo: 0, hi: 0.6 * fcMax, color: '#94d2bd' },
    { z: 2, label: 'Z2 Endurance', lo: 0.6 * fcMax, hi: 0.7 * fcMax, color: '#0ead69' },
    { z: 3, label: 'Z3 Tempo', lo: 0.7 * fcMax, hi: 0.8 * fcMax, color: '#ffd23f' },
    { z: 4, label: 'Z4 Seuil', lo: 0.8 * fcMax, hi: 0.9 * fcMax, color: '#ff6b35' },
    { z: 5, label: 'Z5 VMA', lo: 0.9 * fcMax, hi: 999, color: '#ee4266' },
  ];
}

// Répartition du temps par zone sur les n dernières semaines (via avgHr par séance,
// ou série FC si dispo pour plus de précision).
export function zoneDistribution(acts, fcMax = 195, sinceDays = 42) {
  const zones = hrZones(fcMax);
  const totals = zones.map(() => 0);
  const runs = runsOnly(acts).filter(a => new Date(a.date) > addDays(new Date(), -sinceDays));
  for (const a of runs) {
    if (a.hrSeries && a.hrSeries.length > 5) {
      const per = (a.movingTime || 0) / a.hrSeries.length;
      for (const [, bpm] of a.hrSeries) {
        const zi = zones.findIndex(z => bpm >= z.lo && bpm < z.hi);
        if (zi >= 0) totals[zi] += per;
      }
    } else if (a.avgHr && a.movingTime) {
      const zi = zones.findIndex(z => a.avgHr >= z.lo && a.avgHr < z.hi);
      if (zi >= 0) totals[zi] += a.movingTime;
    }
  }
  return zones.map((z, i) => ({ ...z, seconds: Math.round(totals[i]) }));
}

// ---------- Efficacité aérobie ----------
// Sur les footings faciles (FC < 78 % FCmax) : vitesse (m/min) / FC.
// En hausse = le moteur s'améliore. Retourne [{date, ei, pace, hr}].

export function aerobicEfficiency(acts, fcMax = 195) {
  return runsOnly(acts)
    .filter(a => a.avgHr && a.avgHr < 0.78 * fcMax && a.distance >= 3000)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map(a => ({
      date: isoDay(a.date),
      ei: +(((a.distance / (a.movingTime / 60)) / a.avgHr)).toFixed(3),
      pace: paceOf(a.distance, a.movingTime),
      hr: a.avgHr,
    }));
}

// ---------- Allure vs temps (tendance par type d'effort) ----------

export function paceHistory(acts, sinceDays = 365) {
  return runsOnly(acts)
    .filter(a => new Date(a.date) > addDays(new Date(), -sinceDays))
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map(a => ({
      date: isoDay(a.date),
      pace: paceOf(a.distance, a.movingTime),
      km: a.distance / 1000,
      hr: a.avgHr,
      name: a.name,
    }))
    .filter(p => p.pace && p.pace > 150 && p.pace < 720);
}

// ---------- Agrégats globaux ----------

export function totals(acts) {
  const runs = runsOnly(acts);
  const now = new Date();
  const yearRuns = runs.filter(a => new Date(a.date).getFullYear() === now.getFullYear());
  const last30 = runs.filter(a => new Date(a.date) > addDays(now, -30));
  return {
    allKm: sum(runs.map(a => a.distance)) / 1000,
    allCount: runs.length,
    allHours: sum(runs.map(a => a.movingTime)) / 3600,
    yearKm: sum(yearRuns.map(a => a.distance)) / 1000,
    yearCount: yearRuns.length,
    last30Km: sum(last30.map(a => a.distance)) / 1000,
    last30Count: last30.length,
    firstDate: runs.length ? runs.reduce((a, b) => (a.date < b.date ? a : b)).date : null,
  };
}

// ---------- Score de préparation sub-50 ----------
// 4 composantes sur 100 : prédiction chrono, volume, régularité programme, tendance efficacité.

export function readinessSub50(acts, programStats, metricsVo2) {
  const parts = [];

  // 1. Prédiction Riegel vs 50:00 (40 pts)
  const pred = predict10k(acts);
  if (pred) {
    const target = 50 * 60;
    // 55:00 => 0 pt, 50:00 => 34 pts, 48:30 => 40 pts
    const score = clamp(40 - ((pred.predicted - (target - 90)) / (5.5 * 60 - (-90))) * 40, 0, 40);
    parts.push({ label: 'Chrono projeté (Riegel)', score: Math.round(score), max: 40, detail: pred });
  } else {
    parts.push({ label: 'Chrono projeté (Riegel)', score: 0, max: 40, detail: null });
  }

  // 2. Volume des 4 dernières semaines vs 25 km/sem (25 pts)
  const weeks = weeklyVolume(acts, 4);
  const avgKm = mean(weeks.map(w => w.km)) || 0;
  parts.push({ label: 'Volume (obj. ~25 km/sem)', score: Math.round(clamp(avgKm / 25, 0, 1) * 25), max: 25, detail: avgKm });

  // 3. Assiduité au programme (20 pts)
  const adherence = programStats ? programStats.completionDue : 0;
  parts.push({ label: 'Assiduité programme', score: Math.round(clamp(adherence, 0, 1) * 20), max: 20, detail: adherence });

  // 4. VO₂max : niveau + tendance (15 pts)
  if (metricsVo2 && metricsVo2.length >= 2) {
    const recent = metricsVo2.slice(-8).map(m => m.qty);
    const level = clamp(((mean(recent) || 0) - 46) / (55 - 46), 0, 1) * 10;
    const tr = linearTrend(recent);
    const trendPts = tr && tr.slope > 0 ? 5 : tr && tr.slope > -0.05 ? 3 : 0;
    parts.push({ label: 'VO₂max', score: Math.round(level + trendPts), max: 15, detail: recent[recent.length - 1] });
  } else {
    parts.push({ label: 'VO₂max', score: 0, max: 15, detail: null });
  }

  const total = sum(parts.map(p => p.score));
  return { total, parts };
}

// ---------- Séries de métriques santé prêtes à tracer ----------
// metrics : liste brute de la base ; retourne { labels, values } lissé 7 j si demandé.

export function metricSeries(metrics, name, sinceDays = 180) {
  const cutoff = isoDay(addDays(new Date(), -sinceDays));
  return metrics
    .filter(m => m.name === name && m.date >= cutoff)
    .sort((a, b) => a.date.localeCompare(b.date));
}
