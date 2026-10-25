// ============================================================
// RunQuest — résumé statistique à transmettre à une IA (Claude).
// Génère un texte Markdown compact de TES stats, suivi d'une consigne
// d'INTERPRÉTATION seule (pas de conseil, pas de plan).
// ============================================================

import { fmtKm, fmtPace, fmtDuration, fmtDate, mean, median, linearTrend, isoDay } from './utils.js';
import {
  runsOnly, totals, compare30d, fitnessSeries, acwrSeries, monotony, weeklyVolume,
  predict10k, riegel, vdot, monthlyVdot, aerobicEfficiency, driftSeries, records,
  zoneDistribution, metricSeries,
} from './analytics.js';

// tendance bout-à-bout d'une série de nombres → texte « +X » / « −X » / « stable »
function trendStr(values, digits = 0, unit = '') {
  const v = values.filter(x => x != null && isFinite(x));
  if (v.length < 3) return '';
  const tr = linearTrend(v);
  if (!tr) return '';
  const d = tr.slope * (v.length - 1);
  if (Math.abs(d) < Math.pow(10, -digits) / 2) return ' (stable)';
  const s = d > 0 ? '+' : '−';
  return ` (tendance ${s}${Math.abs(d).toFixed(digits)}${unit} sur la période)`;
}

export function buildReport(ctx) {
  const { activities, metrics, settings = {} } = ctx;
  const fcMax = settings.fcMax || 195, fcRepos = settings.fcRepos || 55;
  const runs = runsOnly(activities);
  const L = [];
  const p = s => L.push(s);

  p(`# Résumé RunQuest — ${fmtDate(new Date(), { day: 'numeric', month: 'long', year: 'numeric' })}`);
  p(`Objectif de référence : 10 km en moins de 50:00 (« sub-50 »). Profil : FC max ${fcMax} bpm, FC repos ${fcRepos} bpm.`);

  if (!runs.length) {
    p('\nAucune donnée de course disponible.');
    return L.join('\n');
  }

  // ---------- Vue d'ensemble ----------
  const t = totals(activities);
  p('\n## Vue d’ensemble');
  p(`- Total : ${t.allCount} sorties · ${t.allKm.toFixed(0)} km · ${t.allHours.toFixed(0)} h, depuis ${fmtDate(t.firstDate, { month: 'long', year: 'numeric' })}`);
  p(`- Cette année : ${t.yearKm.toFixed(0)} km en ${t.yearCount} sorties`);
  p(`- 30 derniers jours : ${t.last30Km.toFixed(0)} km (${t.last30Count} sorties)`);

  // ---------- Comparatif 30 j ----------
  const cmp = compare30d(activities);
  if (cmp.current.count || cmp.previous.count) {
    const c = cmp.current, pr = cmp.previous;
    const dPace = (c.pace && pr.pace) ? Math.round(c.pace - pr.pace) : null;
    p('\n## 30 derniers jours vs 30 précédents');
    p(`- Volume : ${c.km} km (vs ${pr.km}) · Sorties : ${c.count} (vs ${pr.count})`);
    p(`- Allure moy. : ${fmtPace(c.pace)} (vs ${fmtPace(pr.pace)}${dPace != null ? `, ${dPace <= 0 ? dPace + ' s/km plus rapide' : '+' + dPace + ' s/km plus lent'}` : ''})`);
    if (c.hr || pr.hr) p(`- FC moy. : ${c.hr ? Math.round(c.hr) + ' bpm' : '—'} (vs ${pr.hr ? Math.round(pr.hr) + ' bpm' : '—'})`);
    if (c.cadence || pr.cadence) p(`- Cadence : ${c.cadence ? Math.round(c.cadence) : '—'} (vs ${pr.cadence ? Math.round(pr.cadence) : '—'}) spm`);
    p(`- Dénivelé : ${c.elev} m D+ (vs ${pr.elev} m)`);
  }

  // ---------- Charge ----------
  const fit = fitnessSeries(activities, 180, fcMax, fcRepos);
  if (fit.length) {
    const last = fit.at(-1);
    const formLabel = last.tsb > 10 ? 'très frais (affûté)' : last.tsb > -5 ? 'équilibré' : last.tsb > -20 ? 'en charge' : 'très fatigué';
    p('\n## Charge d’entraînement (modèle CTL/ATL/TSB)');
    p(`- Fitness (CTL, charge chronique 42 j) : ${Math.round(last.ctl)}`);
    p(`- Fatigue (ATL, charge aiguë 7 j) : ${Math.round(last.atl)}`);
    p(`- Forme (TSB = CTL − ATL) : ${last.tsb > 0 ? '+' : ''}${Math.round(last.tsb)} → ${formLabel}`);
  }
  const acwr = acwrSeries(activities, 90, fcMax, fcRepos);
  const lastAcwr = [...acwr].reverse().find(a => a.ratio != null);
  if (lastAcwr) {
    const r = lastAcwr.ratio;
    const zone = r < 0.8 ? 'charge faible / désentraînement' : r <= 1.3 ? 'zone optimale (0,8–1,3)' : r <= 1.5 ? 'élevée' : 'risque de blessure (> 1,5)';
    p(`- ACWR (ratio charge aiguë 7 j / chronique 28 j) : ${r.toFixed(2)} → ${zone}`);
  }
  const mono = monotony(activities, fcMax, fcRepos);
  if (mono.monotony != null) p(`- Monotonie 7 j (Foster) : ${mono.monotony} · charge hebdo ${mono.weekLoad} · contrainte ${mono.strain}`);

  // ---------- Volume hebdomadaire ----------
  const vol = weeklyVolume(activities, 10).filter(w => w.km > 0 || true);
  if (vol.length) {
    p('\n## Volume hebdomadaire (10 dernières semaines, km · charge)');
    vol.forEach(w => p(`- Semaine du ${fmtDate(w.week, { day: 'numeric', month: 'short' })} : ${w.km.toFixed(1)} km · charge ${w.load}`));
  }

  // ---------- Performance / projections ----------
  p('\n## Performance & projections');
  const pred = predict10k(activities);
  if (pred) {
    const delta = pred.predicted - 50 * 60;
    p(`- Projection 10 km (Riegel) : ${fmtDuration(pred.predicted)} (${delta <= 0 ? fmtDuration(-delta) + ' sous le sub-50' : fmtDuration(delta) + ' au-dessus du sub-50'}) — d’après ${pred.activity.name}, ${fmtKm(pred.activity.distance)} en ${fmtDuration(pred.activity.movingTime)} le ${fmtDate(pred.activity.date)}`);
    p(`- Équivalents Riegel : 5 km ${fmtDuration(riegel(pred.activity.movingTime, pred.activity.distance, 5000))} · 10 km ${fmtDuration(riegel(pred.activity.movingTime, pred.activity.distance, 10000))} · semi ${fmtDuration(riegel(pred.activity.movingTime, pred.activity.distance, 21097))}`);
  }
  const mv = monthlyVdot(activities).filter(m => m.v);
  if (mv.length >= 2) p(`- VDOT mensuel (meilleure perf/mois) : ${mv.at(-1).v} actuellement${trendStr(mv.map(m => m.v), 1)} — sub-50 ≈ VDOT 40`);
  const eff = aerobicEfficiency(activities, fcMax);
  if (eff.length >= 4) p(`- Efficacité aérobie (m/min par battement, footings faciles) : ${eff.at(-1).ei.toFixed(3)}${trendStr(eff.map(e => e.ei), 3)}`);
  const drifts = driftSeries(activities, fcMax, 60).map(d => d.drift);
  if (drifts.length >= 3) p(`- Dérive cardiaque moyenne (sorties récentes) : ${mean(drifts).toFixed(1)} % (< 5 % = base aérobie solide)`);

  // ---------- Records ----------
  const recs = records(activities).filter(r => r.best);
  if (recs.length) {
    p('\n## Records par tranche de distance (meilleure allure)');
    recs.forEach(r => p(`- ${r.label} : ${fmtPace(paceSafe(r.best))} — ${fmtKm(r.best.distance)} en ${fmtDuration(r.best.movingTime)} le ${fmtDate(r.best.date, { day: 'numeric', month: 'short', year: '2-digit' })} (${r.count} sorties)`));
  }

  // ---------- Santé / récupération ----------
  const health = [];
  const vo2 = metricSeries(metrics, 'vo2_max', 540);
  if (vo2.length) health.push(`- VO₂max : ${vo2.at(-1).qty.toFixed(1)} ml/kg/min${trendStr(vo2.map(m => m.qty), 1)} — fourchette sub-50 ≈ 52–54`);
  const rhr = metricSeries(metrics, 'resting_heart_rate', 90);
  if (rhr.length) health.push(`- FC de repos : ${Math.round(rhr.at(-1).qty)} bpm (base médiane ${Math.round(median(rhr.map(m => m.qty)))})${trendStr(rhr.map(m => m.qty), 0, ' bpm')}`);
  const hrv = metricSeries(metrics, 'heart_rate_variability', 90);
  if (hrv.length) health.push(`- HRV (variabilité cardiaque) : ${Math.round(hrv.at(-1).qty)} ms (base médiane ${Math.round(median(hrv.map(m => m.qty)))})${trendStr(hrv.map(m => m.qty), 0, ' ms')}`);
  const sleep = metricSeries(metrics, 'sleep', 14).map(m => m.total).filter(Boolean);
  if (sleep.length) { const a = mean(sleep); health.push(`- Sommeil (moy. 14 nuits) : ${Math.floor(a)} h ${String(Math.round((a % 1) * 60)).padStart(2, '0')}`); }
  if (health.length) { p('\n## Santé & récupération'); health.forEach(p); }

  // ---------- Technique ----------
  const tech = [];
  const addTech = (label, name, unit, digits) => {
    const d = metricSeries(metrics, name, 365);
    if (d.length >= 3) tech.push(`- ${label} : ${d.at(-1).qty.toFixed(digits)} ${unit}${trendStr(d.map(m => m.qty), digits, ' ' + unit)}`);
  };
  addTech('Longueur de foulée', 'running_stride_length', 'm', 2);
  addTech('Temps de contact au sol', 'running_ground_contact_time', 'ms', 0);
  addTech('Oscillation verticale', 'running_vertical_oscillation', 'cm', 1);
  addTech('Puissance', 'running_power', 'W', 0);
  addTech('Vitesse (capteur)', 'running_speed', 'km/h', 1);
  const cadRuns = runs.filter(a => a.cadence && a.cadence > 120).sort((a, b) => new Date(a.date) - new Date(b.date));
  if (cadRuns.length >= 4) tech.push(`- Cadence (par sortie) : ${Math.round(mean(cadRuns.slice(-10).map(a => a.cadence)))} spm (moy. 10 dernières)${trendStr(cadRuns.map(a => a.cadence), 0, ' spm')}`);
  if (tech.length) { p('\n## Dynamique / technique de course'); tech.forEach(p); }

  // ---------- Zones FC ----------
  const zones = zoneDistribution(activities, fcMax, 42);
  const totalZ = zones.reduce((a, z) => a + z.seconds, 0);
  if (totalZ > 0) {
    p('\n## Répartition de l’intensité — temps par zone FC (6 dernières semaines)');
    zones.forEach(z => { if (z.seconds) p(`- ${z.label} : ${fmtDuration(z.seconds)} (${Math.round(z.seconds / totalZ * 100)} %)`); });
    const easy = Math.round((zones[0].seconds + zones[1].seconds) / totalZ * 100);
    const hard = Math.round((zones[3].seconds + zones[4].seconds) / totalZ * 100);
    p(`- Équilibre : ${easy} % facile (Z1–Z2) / ${100 - easy - hard} % modéré (Z3) / ${hard} % intense (Z4–Z5)`);
  }

  // ---------- Consigne : interprétation SEULE ----------
  p('\n---');
  p('**Interprète ces statistiques de course à pied, sans donner de conseils.**');
  p('Pour chaque domaine (vue d’ensemble, charge CTL/ATL/TSB et ACWR, performance et projections, records, récupération HRV/FC repos/sommeil, technique de course, répartition de l’intensité) :');
  p('1. Explique ce que mesure chaque indicateur et ce que signifie ma valeur actuelle.');
  p('2. Dis ce que montrent les tendances (ce qui progresse, stagne ou régresse), chiffres à l’appui.');
  p('3. Situe mes valeurs par rapport aux repères usuels et à l’objectif sub-50.');
  p('Contrainte : **interprétation et constat uniquement — aucun conseil d’entraînement, aucune recommandation, aucun plan, aucune séance proposée.**');

  return L.join('\n');
}

function paceSafe(a) {
  return a && a.distance && a.movingTime ? a.movingTime / (a.distance / 1000) : null;
}
