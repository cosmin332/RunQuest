// ============================================================
// RunQuest — moteur de conclusions/conseils sous les graphiques.
// Chaque fonction reçoit les données déjà calculées d'un graphique et
// renvoie { tone: 'good'|'warn'|'info', text } — ou null si pas assez de data.
// Le texte est recalculé à chaque rendu : il évolue avec tes stats.
// ============================================================

import { linearTrend, mean } from './utils.js';

export const box = (tone, text) => ({ tone, text });

// Variation linéaire bout à bout d'une série (régression) : { delta, avg, n }.
function change(values) {
  const v = values.map(Number).filter(x => isFinite(x));
  if (v.length < 3) return null;
  const tr = linearTrend(v);
  if (!tr) return null;
  return { delta: tr.slope * (v.length - 1), avg: mean(v), n: v.length };
}

function pearson(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 5) return null;
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; num += a * b; dx += a * a; dy += b * b; }
  return (dx && dy) ? num / Math.sqrt(dx * dy) : null;
}

// ---------- Performance ----------

export function analyzeCompare(cmp) {
  const c = cmp.current, p = cmp.previous;
  if (!p.count || !c.count) return null;
  const bits = [];
  if (c.pace && p.pace) {
    const d = c.pace - p.pace; // sec/km, négatif = plus rapide
    if (d < -4) bits.push(`allure moyenne ${Math.round(-d)} s/km plus rapide`);
    else if (d > 4) bits.push(`allure ${Math.round(d)} s/km plus lente`);
  }
  if (c.km && p.km) {
    const pct = (c.km - p.km) / p.km * 100;
    if (Math.abs(pct) > 12) bits.push(`volume ${pct > 0 ? '+' : ''}${Math.round(pct)} %`);
  }
  if (c.hr && p.hr && Math.abs(c.hr - p.hr) >= 3) bits.push(`FC moy. ${c.hr < p.hr ? '−' : '+'}${Math.round(Math.abs(c.hr - p.hr))} bpm`);
  const fasterLowerHr = c.pace < p.pace - 3 && c.hr && p.hr && c.hr <= p.hr + 1;
  if (fasterLowerHr) return box('good', `Tu cours plus vite pour une FC égale ou moindre : progrès net de la forme. ${bits.join(', ')}. Ne change rien de brusque.`);
  if (c.pace > p.pace + 6 && c.km > p.km * 1.1) return box('info', `Tu es plus lent mais tu cours plus : normal en phase de volume, l'allure reviendra à l'affûtage. ${bits.join(', ')}.`);
  if (!bits.length) return box('info', 'Mois très comparable au précédent. La régularité est ta meilleure alliée vers le sub-50.');
  return box('info', `Sur 30 jours : ${bits.join(', ')}.`);
}

export function analyzePace(hist) {
  const c = change(hist.map(h => h.pace));
  if (!c) return null;
  if (c.delta < -6) return box('good', `Tendance à l'accélération : ~${Math.round(-c.delta)} s/km gagnés sur la période à effort comparable. Ce que tu fais marche — garde ce mélange EF lent + qualité.`);
  if (c.delta > 6) return box('warn', `Tes allures moyennes ralentissent (~${Math.round(c.delta)} s/km). Si ce n'est pas volontaire (gros volume, chaleur), place une semaine allégée et vérifie ton sommeil.`);
  return box('info', `Allure globalement stable. Pour débloquer du chrono : une vraie séance de qualité/semaine (seuil ou VMA), et tout le reste vraiment lent.`);
}

export function analyzeVo2(vo2) {
  if (vo2.length < 2) return null;
  const last = vo2.at(-1).qty;
  const c = change(vo2.map(m => m.qty));
  const delta = c ? c.delta : 0;
  const level = last >= 54 ? `À ${last.toFixed(1)} tu es au-dessus du seuil sub-50 : la cylindrée est là, tout se joue sur l'exécution.`
    : last >= 51 ? `À ${last.toFixed(1)} tu es dans la fourchette sub-50 (52–54).`
      : `À ${last.toFixed(1)} il manque un peu de plafond aérobie (vise 52+) — VMA et seuil le feront monter.`;
  if (delta < -0.8) return box('warn', `VO₂max en baisse. ${level} Une baisse traduit souvent fatigue ou manque de sommeil : soigne la récupération.`);
  if (delta > 0.8) return box('good', `VO₂max en hausse. ${level} Continue exactement sur cette lancée.`);
  return box('info', `VO₂max stable. ${level}`);
}

export function analyzeEfficiency(eff) {
  const c = change(eff.map(e => e.ei));
  if (!c || !c.avg) return null;
  const pct = c.delta / c.avg * 100;
  if (pct > 3) return box('good', `Efficacité aérobie en hausse (~${pct.toFixed(0)} %) : à FC égale tu vas plus vite. Preuve que l'endurance de base progresse — continue le volume lent.`);
  if (pct < -3) return box('warn', `Efficacité aérobie en baisse (~${pct.toFixed(0)} %) : souvent fatigue accumulée ou footings courus trop vite. Ralentis franchement les EF et dors plus.`);
  return box('info', `Efficacité aérobie stable. Pour la faire grimper : plus de kilomètres faciles en Z2, à allure conversationnelle.`);
}

export function analyzeDrift(drifts) {
  const avg = mean(drifts.map(d => d.drift));
  if (avg == null) return null;
  if (avg < 5) return box('good', `Dérive cardiaque moyenne ${avg.toFixed(1)} % : ton cœur reste stable dans la durée = très bonne endurance. Tu tiendras l'allure jusqu'au bout du 10 km.`);
  if (avg < 9) return box('info', `Dérive moyenne ${avg.toFixed(1)} % : correcte. Pour la réduire, allonge un peu tes sorties faciles en gardant une allure vraiment basse.`);
  return box('warn', `Dérive moyenne ${avg.toFixed(1)} % : ta FC grimpe beaucoup en fin de sortie, la base aérobie manque de fond. Priorise le volume lent avant d'ajouter de l'intensité.`);
}

export function analyzeVdot(mv) {
  const vals = mv.filter(m => m.v).map(m => m.v);
  if (vals.length < 3) return null;
  const c = change(vals);
  const last = vals.at(-1);
  const target = last >= 40 ? `Tu es au niveau VDOT d'un sub-50 (~40).` : `Vise VDOT ~40 pour le sub-50 (actuel ${last.toFixed(0)}).`;
  if (c && c.delta > 0.8) return box('good', `VDOT en progression. ${target} Le travail de qualité paie.`);
  if (c && c.delta < -0.8) return box('warn', `VDOT en léger recul. ${target} Vérifie ta fraîcheur et la régularité des séances.`);
  return box('info', `VDOT stable. ${target}`);
}

// ---------- Charge ----------

export function analyzeForm(fit) {
  if (fit.length < 7) return null;
  const t = fit.at(-1).tsb;
  if (t > 15) return box('info', `Forme à +${Math.round(t)} : très frais/affûté. Parfait juste avant un objectif ; sinon, ça veut dire que tu t'entraînes peu — tu peux relancer la charge.`);
  if (t >= 5) return box('good', `Forme à +${Math.round(t)} : frais et disponible. Bon moment pour une grosse séance de qualité ou un test.`);
  if (t >= -10) return box('good', `Forme à ${Math.round(t)} : zone d'entraînement productive, tu encaisses sans surcharge. Continue.`);
  if (t >= -20) return box('info', `Forme à ${Math.round(t)} : charge élevée (normal en plein bloc). Garde un vrai jour facile et surveille les signaux de fatigue.`);
  return box('warn', `Forme à ${Math.round(t)} : fatigue marquée. Place une journée de repos ou un footing très court — surtout avec tes tibias sensibles.`);
}

export function analyzeVolume(vol) {
  const nz = vol.filter(w => w.km > 0);
  if (nz.length < 4) return null;
  const last4 = vol.slice(-4).reduce((a, w) => a + w.km, 0);
  const prev4 = vol.slice(-8, -4).reduce((a, w) => a + w.km, 0);
  if (prev4 > 5) {
    const pct = (last4 - prev4) / prev4 * 100;
    if (pct > 30) return box('warn', `+${Math.round(pct)} % de volume sur 4 semaines : montée trop rapide (limite conseillée +10 %/sem, surtout tibias). Stabilise avant d'ajouter des km.`);
    if (pct < -25) return box('info', `Volume en baisse de ${Math.round(-pct)} % sur 4 semaines (allègement ou coupure). Reprends progressivement, +10 % max par semaine.`);
    return box('good', `Volume en progression maîtrisée (${pct >= 0 ? '+' : ''}${Math.round(pct)} % sur 4 semaines) : le bon rythme.`);
  }
  return box('info', `Reprise du volume en cours. Monte de ~10 % par semaine au maximum pour protéger tes tibias.`);
}

export function analyzeAcwr(acwr) {
  const last = [...acwr].reverse().find(a => a.ratio != null);
  if (!last) return null;
  const r = last.ratio;
  if (r > 1.5) return box('warn', `Ratio ${r.toFixed(2)} : ta charge récente a bondi vs ton habitude — zone de risque de blessure. Cette semaine, stabilise ou réduis le volume, et surtout pas d'intensité en plus.`);
  if (r < 0.8) return box('info', `Ratio ${r.toFixed(2)} : charge récente basse (reprise/repos). Tu peux ré-augmenter, mais progressivement (+10 % de volume max).`);
  return box('good', `Ratio ${r.toFixed(2)} : progression maîtrisée, pile dans la zone sûre (0,8–1,3). Continue à monter en douceur.`);
}

export function analyzeMonthlyKm(months) {
  const nz = months.filter(m => m.km > 0);
  if (nz.length < 3) return null;
  const c = change(months.slice(-4).map(m => m.km));
  if (!c) return null;
  if (c.delta > 5) return box('good', `Kilométrage mensuel en hausse régulière : bon socle en construction. Garde juste 1 semaine allégée sur 3–4.`);
  if (c.delta < -5) return box('info', `Kilométrage mensuel en repli récent. Si ce n'est pas voulu, planifie tes sorties pour retrouver de la régularité — elle prime sur les pics.`);
  return box('info', `Kilométrage mensuel stable. Mieux vaut 4 mois constants qu'un gros mois isolé suivi d'une coupure.`);
}

export function analyzeZones(zones) {
  const total = zones.reduce((a, z) => a + z.seconds, 0);
  if (!total) return null;
  const easy = (zones[0].seconds + zones[1].seconds) / total;
  const hard = (zones[3].seconds + zones[4].seconds) / total;
  if (easy >= 0.78) return box('good', `${Math.round(easy * 100)} % de ton temps en Z1–Z2 : polarisation idéale (~80/20). Tes tibias et ton endurance de base te remercient.`);
  if (easy >= 0.65) return box('info', `${Math.round(easy * 100)} % en zone facile : bien, mais vise 80 %. Ralentis encore les footings pour muscler l'aérobie sans t'user.`);
  return box('warn', `Seulement ${Math.round(easy * 100)} % en facile et ${Math.round(hard * 100)} % en intensité : trop dur, trop souvent. Ralentis franchement les EF pour mieux récupérer entre les séances de qualité.`);
}

// ---------- Santé ----------

export function analyzeBalance(points) {
  if (points.length < 14) return null;
  const recent = points.slice(-7), prev = points.slice(-14, -7);
  const hrvR = mean(recent.map(p => p.hrv)), hrvP = mean(prev.map(p => p.hrv));
  const loadR = mean(recent.map(p => p.load)), loadP = mean(prev.map(p => p.load));
  if (hrvR == null || hrvP == null) return null;
  const loadUp = loadP > 0 && loadR > loadP * 1.1;
  const hrvDown = hrvR < hrvP * 0.95;
  if (loadUp && hrvDown) return box('warn', `Ta charge monte pendant que ta HRV baisse : ton corps commence à ne plus suivre. Cale une journée de récupération avant la prochaine séance dure.`);
  if (!loadUp && hrvR > hrvP) return box('good', `HRV qui remonte avec une charge maîtrisée : bien récupéré, tu peux pousser la prochaine séance de qualité.`);
  return box('info', `Charge et récupération globalement en équilibre. Reste attentif : une HRV qui plonge 2–3 jours de suite = signal pour alléger.`);
}

export function analyzeRhr(data) {
  const c = change(data.map(m => m.qty));
  if (!c) return null;
  if (c.delta < -1.5) return box('good', `FC de repos en baisse : ton cœur devient plus efficace, la forme s'installe.`);
  if (c.delta > 2) return box('warn', `FC de repos en hausse : peut trahir fatigue, stress ou début de maladie. Si ça dure quelques jours, lève le pied.`);
  return box('info', `FC de repos stable. Une baisse progressive accompagnera naturellement tes progrès aérobies.`);
}

export function analyzeHrv(data) {
  const c = change(data.map(m => m.qty));
  if (!c) return null;
  if (c.delta > 3) return box('good', `HRV en hausse : ta récupération et ton adaptation à l'entraînement s'améliorent. Bon feu vert pour encaisser la charge.`);
  if (c.delta < -3) return box('warn', `HRV en baisse tendancielle : ton système nerveux récupère moins bien. Priorise sommeil et jours faciles avant d'enchaîner les séances dures.`);
  return box('info', `HRV stable. Fie-toi surtout aux chutes brutales sur 2–3 jours pour décider d'alléger.`);
}

export function analyzeRecovery(data) {
  const avg = mean(data.slice(-10).map(m => m.qty));
  if (avg == null) return null;
  if (avg >= 30) return box('good', `Récupération cardiaque ${Math.round(avg)} bpm/min : très bon (>30). Ton cœur revient vite au calme après l'effort.`);
  if (avg >= 20) return box('info', `Récupération cardiaque ${Math.round(avg)} bpm/min : correcte. Elle montera avec le volume aérobie.`);
  return box('warn', `Récupération cardiaque basse (${Math.round(avg)} bpm/min) : le cœur redescend lentement, signe d'un fond aérobie à renforcer. Plus d'endurance facile aidera.`);
}

export function analyzeWeight(data) {
  const c = change(data.map(m => m.qty));
  if (!c) return null;
  if (Math.abs(c.delta) < 0.7) return box('info', `Poids stable : rien à changer. La constance pondérale aide la régularité des allures.`);
  if (c.delta < 0) return box('info', `Poids en légère baisse (~${c.delta.toFixed(1)} kg). ~2–3 s/km se gagnent par kilo au 10 km — mais ne sacrifie jamais l'énergie de tes séances.`);
  return box('info', `Poids en légère hausse (~+${c.delta.toFixed(1)} kg). Pas d'inquiétude si c'est du renfo ; surveille juste l'alimentation autour des grosses semaines.`);
}

export function analyzeSleep(avg) {
  if (avg == null) return null;
  const h = Math.floor(avg), m = String(Math.round((avg % 1) * 60)).padStart(2, '0');
  if (avg >= 7.5) return box('good', `${h} h ${m} de sommeil en moyenne : idéal pour absorber la charge et progresser. C'est la nuit que le corps se répare.`);
  if (avg >= 7) return box('info', `${h} h ${m} de sommeil : correct, mais viser 7 h 30–8 h accélérerait ta récupération.`);
  return box('warn', `${h} h ${m} de sommeil : trop peu. Le manque de sommeil freine les gains et fragilise les tibias — c'est ton levier n°1 en ce moment.`);
}

// ---------- Technique ----------

export function analyzeCadence(avg) {
  if (avg == null) return null;
  if (avg >= 170) return box('good', `Cadence moyenne ${Math.round(avg)} pas/min : dans la zone efficace (170–180). Bon amorti, impact réduit sur les tibias.`);
  if (avg >= 162) return box('info', `Cadence moyenne ${Math.round(avg)} pas/min : un poil basse. Vise +5 pas/min en raccourcissant la foulée (sans forcer) pour soulager les tibias.`);
  return box('warn', `Cadence moyenne ${Math.round(avg)} pas/min : basse, tu tires sur la foulée. Monter vers 170 réduira nettement l'impact articulaire — travaille des lignes droites à cadence rapide.`);
}

export function analyzeCadencePace(cadPace) {
  const r = pearson(cadPace.map(p => -p.pace), cadPace.map(p => p.cad));
  if (r == null) return null;
  if (r > 0.4) return box('good', `Ta cadence augmente bien quand tu accélères : bon réflexe, tu montes en régime sans sur-allonger la foulée.`);
  if (r > 0.1) return box('info', `Ta cadence monte un peu avec la vitesse. Pour aller plus vite sainement, cherche à tourner les jambes plus vite plutôt qu'à allonger la foulée.`);
  return box('warn', `Ta cadence reste plate même en accélérant : tu gagnes de la vitesse en allongeant la foulée = plus d'impact au sol. Travaille des accélérations à cadence élevée.`);
}

export function analyzeGct(data) {
  const avg = mean(data.slice(-10).map(m => m.qty));
  if (avg == null) return null;
  const c = change(data.map(m => m.qty));
  const lvl = avg <= 250 ? 'réactif' : avg <= 290 ? 'correct' : 'un peu long';
  const trend = c && c.delta < -5 ? ' Et il diminue : ta foulée devient plus vive.' : c && c.delta > 5 ? ' Il augmente : attention à la fatigue qui alourdit la foulée.' : '';
  const tone = avg <= 250 ? 'good' : avg <= 290 ? 'info' : 'warn';
  return box(tone, `Temps de contact au sol moyen ${Math.round(avg)} ms (${lvl}).${trend} Lignes droites et gainage le raccourcissent.`);
}

export function analyzeVertOsc(data) {
  const avg = mean(data.slice(-10).map(m => m.qty));
  if (avg == null) return null;
  if (avg <= 9) return box('good', `Oscillation verticale ${avg.toFixed(1)} cm : tu rebondis peu, l'énergie part bien vers l'avant.`);
  if (avg <= 11) return box('info', `Oscillation verticale ${avg.toFixed(1)} cm : correcte. Une cadence un peu plus haute réduira le rebond.`);
  return box('warn', `Oscillation verticale ${avg.toFixed(1)} cm : tu rebondis beaucoup (énergie perdue en hauteur). Augmente la cadence et pense « glisser vers l'avant ».`);
}

export function analyzeStride(data) {
  const c = change(data.map(m => m.qty));
  if (!c) return null;
  const dir = c.delta > 0.03 ? 'en hausse' : c.delta < -0.03 ? 'en baisse' : 'stable';
  return box('info', `Longueur de foulée ${dir} (${data.at(-1).qty.toFixed(2)} m en moyenne). Laisse-la s'allonger d'elle-même avec la forme — ne la force jamais, c'est le meilleur moyen de se blesser.`);
}

export function analyzeSpeed(data) {
  const c = change(data.map(m => m.qty));
  if (!c) return null;
  if (c.delta > 0.3) return box('good', `Vitesse de course en hausse : tes séances se traduisent en gains concrets.`);
  if (c.delta < -0.3) return box('info', `Vitesse moyenne en léger repli — souvent lié à plus de volume lent (sain) ou à de la fatigue. Vérifie tes séances de qualité.`);
  return box('info', `Vitesse moyenne stable.`);
}

export function analyzePower(data) {
  const c = change(data.map(m => m.qty));
  if (!c) return null;
  if (c.delta > 5) return box('good', `Puissance en hausse : tu produis plus de force utile. Bon signe si l'allure suit sans que la FC explose.`);
  if (c.delta < -5) return box('info', `Puissance en baisse. Si tes chronos tiennent, c'est peut-être une foulée plus économique ; sinon, un manque de tonus (renfo, lignes droites).`);
  return box('info', `Puissance stable.`);
}

export function analyzeEconomy(eco) {
  const c = change(eco.map(m => m.eco));
  if (!c) return null;
  if (c.delta > 0) return box('good', `Économie de course en amélioration : tu transformes mieux ton énergie en vitesse. C'est exactement ce qui fait baisser les chronos à VO₂max constante.`);
  return box('info', `Économie de course stable. La qualité (seuil, VMA) et la technique (cadence, gainage) l'amélioreront.`);
}
