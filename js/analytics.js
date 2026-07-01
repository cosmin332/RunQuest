// ============================================================
// RunQuest — moteur d'analyse
// Toutes les fonctions prennent des activités normalisées (voir parsers.js),
// triées ou non — elles se chargent du tri.
// ============================================================

import { weekKey, mondayOf, addDays, isoDay, mean, median, sum, paceOf, clamp, linearTrend } from './utils.js';

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

// ---------- Fitness / Fatigue / Forme (modèle CTL/ATL/TSB) ----------
// CTL = charge chronique (moyenne exponentielle 42 j) → « Fitness »
// ATL = charge aiguë (7 j) → « Fatigue »  ·  TSB = CTL - ATL → « Forme »
// Retourne [{ date, ctl, atl, tsb }] sur nDays.

export function fitnessSeries(acts, nDays = 180, fcMax = 195, fcRepos = 55) {
  const runs = runsOnly(acts);
  if (!runs.length) return [];
  const dailyLoad = new Map();
  let firstDay = new Date();
  for (const a of runs) {
    const d = isoDay(a.date);
    dailyLoad.set(d, (dailyLoad.get(d) || 0) + trainingLoad(a, fcMax, fcRepos));
    if (new Date(a.date) < firstDay) firstDay = new Date(a.date);
  }
  const out = [];
  let ctl = 0, atl = 0;
  const today = new Date();
  const start = new Date(Math.max(firstDay.getTime(), addDays(today, -540).getTime()));
  for (let d = new Date(start); d <= today; d = addDays(d, 1)) {
    const load = dailyLoad.get(isoDay(d)) || 0;
    ctl += (load - ctl) / 42;
    atl += (load - atl) / 7;
    if (d >= addDays(today, -nDays)) {
      out.push({ date: isoDay(d), ctl: +ctl.toFixed(1), atl: +atl.toFixed(1), tsb: +(ctl - atl).toFixed(1) });
    }
  }
  return out;
}

// ---------- Monotonie & contrainte (Foster) sur les 7 derniers jours ----------

export function monotony(acts, fcMax = 195, fcRepos = 55) {
  const runs = runsOnly(acts);
  const loads = [];
  for (let i = 6; i >= 0; i--) {
    const day = isoDay(addDays(new Date(), -i));
    loads.push(sum(runs.filter(a => isoDay(a.date) === day).map(a => trainingLoad(a, fcMax, fcRepos))));
  }
  const m = mean(loads) || 0;
  const sd = Math.sqrt(mean(loads.map(l => (l - m) ** 2)) || 0);
  const mono = sd > 0 ? m / sd : null;
  return { weekLoad: sum(loads), monotony: mono ? +mono.toFixed(2) : null, strain: mono ? Math.round(sum(loads) * mono) : null };
}

// ---------- Dérive cardiaque (découplage aérobie) ----------
// Sur les sorties régulières ≥ 25 min avec série FC : FC moyenne 2e moitié vs
// 1re moitié (après 5 min d'échauffement). < 5 % = base aérobie solide.

export function hrDrift(a, fcMax = 195) {
  if (!a.hrSeries || a.hrSeries.length < 12 || !a.movingTime || a.movingTime < 25 * 60) return null;
  if (a.avgHr && a.avgHr > 0.85 * fcMax) return null; // fractionné : non pertinent
  const usable = a.hrSeries.filter(([t]) => t >= 5);
  if (usable.length < 8) return null;
  const mid = Math.floor(usable.length / 2);
  const h1 = mean(usable.slice(0, mid).map(x => x[1]));
  const h2 = mean(usable.slice(mid).map(x => x[1]));
  if (!h1 || !h2) return null;
  return +(((h2 / h1) - 1) * 100).toFixed(1);
}

export function driftSeries(acts, fcMax = 195, sinceDays = 240) {
  return runsOnly(acts)
    .filter(a => new Date(a.date) > addDays(new Date(), -sinceDays))
    .map(a => ({ date: isoDay(a.date), drift: hrDrift(a, fcMax), name: a.name, km: a.distance / 1000 }))
    .filter(x => x.drift != null && x.drift > -8 && x.drift < 25)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ---------- VDOT mensuel (meilleure perf de chaque mois) ----------

export function monthlyVdot(acts, months = 14) {
  const runs = runsOnly(acts).filter(a => a.distance >= 3000);
  const byMonth = new Map();
  for (const a of runs) {
    const key = a.date.slice(0, 7);
    const v = vdot(a.distance, a.movingTime);
    if (v > 20 && v < 85 && (!byMonth.has(key) || v > byMonth.get(key).v)) byMonth.set(key, { v, a });
  }
  const out = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push({ month: key, ...(byMonth.get(key) || { v: null, a: null }) });
  }
  return out;
}

// ---------- Comparatif 30 derniers jours vs 30 précédents ----------

export function compare30d(acts) {
  const runs = runsOnly(acts);
  const now = new Date();
  const win = (from, to) => runs.filter(a => new Date(a.date) > addDays(now, -from) && new Date(a.date) <= addDays(now, -to));
  const agg = list => {
    const km = sum(list.map(a => a.distance)) / 1000;
    const time = sum(list.map(a => a.movingTime));
    const hrList = list.filter(a => a.avgHr);
    const cadList = list.filter(a => a.cadence && a.cadence > 120);
    return {
      km: +km.toFixed(1),
      count: list.length,
      pace: km > 0 ? time / km : null,
      hr: hrList.length ? mean(hrList.map(a => a.avgHr)) : null,
      cadence: cadList.length ? mean(cadList.map(a => a.cadence)) : null,
      elev: Math.round(sum(list.map(a => a.elevGain || 0))),
    };
  };
  return { current: agg(win(30, 0)), previous: agg(win(60, 30)) };
}

// ---------- Récap mensuel (12 mois) ----------

export function monthlyRecap(acts, months = 12) {
  const runs = runsOnly(acts);
  const byMonth = new Map();
  for (const a of runs) {
    const key = a.date.slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, { km: 0, count: 0, elev: 0, time: 0 });
    const m = byMonth.get(key);
    m.km += a.distance / 1000; m.count++; m.elev += a.elevGain || 0; m.time += a.movingTime || 0;
  }
  const out = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push({ month: key, label: d.toLocaleDateString('fr-FR', { month: 'short' }), ...(byMonth.get(key) || { km: 0, count: 0, elev: 0, time: 0 }) });
  }
  return out;
}

// ---------- Feu du jour : prêt à s'entraîner ? ----------
// Compare HRV et FC repos récentes à leurs baselines 30 j + forme (TSB).

export function readinessToday(acts, metrics, fcMax = 195, fcRepos = 55) {
  const hrv = metricSeries(metrics, 'heart_rate_variability', 45);
  const rhr = metricSeries(metrics, 'resting_heart_rate', 45);
  const fit = fitnessSeries(acts, 2, fcMax, fcRepos);
  const tsb = fit.length ? fit.at(-1).tsb : null;

  const parts = [];
  let score = 0, nb = 0;
  if (hrv.length >= 10) {
    const recent = mean(hrv.slice(-3).map(m => m.qty));
    const base = median(hrv.slice(0, -3).map(m => m.qty));
    const ratio = recent / base;
    const s = ratio >= 1.02 ? 2 : ratio >= 0.92 ? 1 : 0;
    parts.push({ label: 'HRV vs baseline', value: `${Math.round(recent)} ms (base ${Math.round(base)})`, s });
    score += s; nb++;
  }
  if (rhr.length >= 10) {
    const recent = mean(rhr.slice(-3).map(m => m.qty));
    const base = median(rhr.slice(0, -3).map(m => m.qty));
    const s = recent <= base + 1 ? 2 : recent <= base + 4 ? 1 : 0;
    parts.push({ label: 'FC repos vs baseline', value: `${Math.round(recent)} bpm (base ${Math.round(base)})`, s });
    score += s; nb++;
  }
  if (tsb != null) {
    const s = tsb >= -5 ? 2 : tsb >= -15 ? 1 : 0;
    parts.push({ label: 'Forme (TSB)', value: tsb > 0 ? `+${tsb}` : `${tsb}`, s });
    score += s; nb++;
  }
  if (!nb) return null;
  const avg = score / nb;
  const status = avg >= 1.5 ? 'green' : avg >= 0.8 ? 'orange' : 'red';
  const advice = {
    green: 'Feu vert : ton corps est prêt, la séance de qualité peut envoyer.',
    orange: 'Feu orange : séance possible mais reste à l’écoute — EF plutôt que qualité si sensation moyenne.',
    red: 'Feu rouge : signaux de fatigue. Repos ou footing très léger, tes tibias te diront merci.',
  }[status];
  return { status, parts, advice };
}

// ---------- Chaussures : usure par paire ----------

export function gearStats(acts) {
  const runs = runsOnly(acts).filter(a => a.gear);
  const byGear = new Map();
  for (const a of runs) {
    if (!byGear.has(a.gear)) byGear.set(a.gear, { km: 0, count: 0, last: a.date, first: a.date });
    const g = byGear.get(a.gear);
    g.km += a.distance / 1000; g.count++;
    if (a.date > g.last) g.last = a.date;
    if (a.date < g.first) g.first = a.date;
  }
  return [...byGear.entries()]
    .map(([name, g]) => ({ name, ...g, km: Math.round(g.km), wear: Math.min(g.km / 700, 1) }))
    .sort((a, b) => b.last.localeCompare(a.last));
}

// ---------- Tops (grands moments) ----------

export function tops(acts) {
  const runs = runsOnly(acts);
  if (!runs.length) return null;
  const weeks = weeklyVolume(acts, 260).filter(w => w.km > 0);
  const months = monthlyRecap(acts, 36).filter(m => m.km > 0);
  const longest = runs.reduce((a, b) => (a.distance > b.distance ? a : b));
  const longestTime = runs.reduce((a, b) => ((a.movingTime || 0) > (b.movingTime || 0) ? a : b));
  const mostElev = runs.filter(a => a.elevGain).sort((a, b) => b.elevGain - a.elevGain)[0] || null;
  const bestWeek = weeks.length ? weeks.reduce((a, b) => (a.km > b.km ? a : b)) : null;
  const bestWeekCount = weeks.length ? weeks.reduce((a, b) => (a.count > b.count ? a : b)) : null;
  const bestMonth = months.length ? months.reduce((a, b) => (a.km > b.km ? a : b)) : null;
  return { longest, longestTime, mostElev, bestWeek, bestWeekCount, bestMonth };
}

// ---------- Insights automatiques ----------
// Phrases générées à partir des tendances marquantes. Retourne [{icon, text, tone}].

export function insights(acts, metrics, fcMax = 195) {
  const out = [];
  const push = (icon, text, tone = 'info') => out.push({ icon, text, tone });

  // Efficacité aérobie sur 8 semaines
  const eff = aerobicEfficiency(acts, fcMax).filter(e => new Date(e.date) > addDays(new Date(), -56));
  if (eff.length >= 6) {
    const tr = linearTrend(eff.map(e => e.ei));
    if (tr) {
      const deltaPct = (tr.slope * (eff.length - 1)) / eff[0].ei * 100;
      if (deltaPct > 2) push('🚀', `À fréquence cardiaque égale, tu cours ~${deltaPct.toFixed(0)} % plus vite qu'il y a 8 semaines sur tes footings faciles. Le moteur aérobie répond.`, 'good');
      else if (deltaPct < -3) push('🪫', `Ton efficacité aérobie recule un peu sur 8 semaines (${deltaPct.toFixed(0)} %) — souvent un signe de fatigue accumulée ou de footings trop rapides.`, 'warn');
    }
  }

  // VO2max 60 j
  const vo2 = metricSeries(metrics, 'vo2_max', 70);
  if (vo2.length >= 4) {
    const delta = vo2.at(-1).qty - vo2[0].qty;
    if (delta >= 1) push('🫁', `VO₂max en hausse de ${delta.toFixed(1)} pt en 2 mois (${vo2.at(-1).qty.toFixed(1)}). La zone sub-50 (~52–54) ${vo2.at(-1).qty >= 52 ? 'est atteinte' : 'se rapproche'}.`, 'good');
    else if (delta <= -1.5) push('🫁', `VO₂max en baisse de ${Math.abs(delta).toFixed(1)} pt en 2 mois — surveille sommeil et récupération.`, 'warn');
  }

  // Volume 4 sem vs 4 précédentes
  const w8 = weeklyVolume(acts, 8);
  if (w8.length === 8) {
    const cur = sum(w8.slice(4).map(w => w.km)), prev = sum(w8.slice(0, 4).map(w => w.km));
    if (prev > 8) {
      const pct = ((cur - prev) / prev) * 100;
      if (pct > 35) push('⚠️', `Volume en hausse de ${pct.toFixed(0)} % sur 4 semaines — au-delà des +10 %/sem recommandés avec tes tibias. Le plan gère la progression : ne rajoute pas.`, 'warn');
      else if (pct > 8) push('📈', `Volume en progression maîtrisée (+${pct.toFixed(0)} % sur 4 semaines).`, 'good');
      else if (pct < -30) push('📉', `Volume en net retrait (-${Math.abs(pct).toFixed(0)} %) sur 4 semaines. Une reprise progressive s'impose avant la qualité.`, 'warn');
    }
  }

  // Dérive cardiaque récente
  const drifts = driftSeries(acts, fcMax, 45);
  if (drifts.length >= 3) {
    const avg = mean(drifts.map(d => d.drift));
    if (avg < 5) push('🫀', `Dérive cardiaque moyenne de ${avg.toFixed(1)} % sur tes sorties longues récentes : base aérobie solide, tu tiendras l'allure au 10 km.`, 'good');
    else if (avg > 9) push('🫀', `Dérive cardiaque élevée (${avg.toFixed(1)} %) : la FC monte beaucoup en fin de sortie. Plus d'EF vraiment lent la corrigera.`, 'warn');
  }

  // Cadence
  const cad = runsOnly(acts).filter(a => a.cadence > 120 && new Date(a.date) > addDays(new Date(), -30));
  if (cad.length >= 3) {
    const avg = mean(cad.map(a => a.cadence));
    if (avg < 165) push('👟', `Cadence moyenne ${Math.round(avg)} pas/min ce mois-ci. Monter vers 170–175 réduirait l'impact sur tes tibias (raccourcis la foulée, ne force pas).`, 'info');
    else push('👟', `Cadence moyenne ${Math.round(avg)} pas/min : bon amorti, tes tibias apprécient.`, 'good');
  }

  // Sommeil 14 j
  const sleep = metricSeries(metrics, 'sleep', 14).map(m => m.total).filter(Boolean);
  if (sleep.length >= 5) {
    const avg = mean(sleep);
    if (avg < 7) push('😴', `${Math.floor(avg)} h ${String(Math.round((avg % 1) * 60)).padStart(2, '0')} de sommeil en moyenne sur 2 semaines : c'est court pour encaisser la charge. Vise 7 h 30+.`, 'warn');
  }

  // Projection 10 km
  const pred = predict10k(acts);
  if (pred) {
    const delta = pred.predicted - 50 * 60;
    if (delta <= 0) push('🏆', `Ta meilleure perf récente projette un 10 km en ${Math.floor(pred.predicted / 60)}:${String(Math.round(pred.predicted % 60)).padStart(2, '0')} — le sub-50 est dans les jambes, reste à le concrétiser le jour J.`, 'good');
    else if (delta < 180) push('🎯', `Plus que ${Math.round(delta / 60)} min ${Math.round(delta % 60)} s à gagner sur la projection Riegel pour le sub-50. Le bloc spécifique est fait pour ça.`, 'info');
  }

  return out;
}

// ---------- Séries de métriques santé prêtes à tracer ----------
// metrics : liste brute de la base ; retourne { labels, values } lissé 7 j si demandé.

export function metricSeries(metrics, name, sinceDays = 180) {
  const cutoff = isoDay(addDays(new Date(), -sinceDays));
  return metrics
    .filter(m => m.name === name && m.date >= cutoff)
    .sort((a, b) => a.date.localeCompare(b.date));
}
