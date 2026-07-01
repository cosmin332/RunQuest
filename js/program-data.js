// ============================================================
// RunQuest — Programme « Plan 10 km sous 50 min — version rectifiée »
// Encodé depuis plan-sub50-rectifie.pdf, séance par séance.
//
// FORMAT D'IMPORT DE PROGRAMME (JSON) — voir aussi l'aide dans l'app :
// {
//   "formatVersion": 1,
//   "programs": [{
//     "id": "identifiant-unique",
//     "name": "Nom du programme",
//     "objective": "10 km < 50:00",
//     "startDate": "2026-07-06",        // lundi de la semaine 1 (modifiable dans l'app)
//     "paces": { "EF": "6:30", "Seuil": "5:00", "VMA": "4:05", "SL": "6:30", "Objectif": "5:00" },
//     "weeks": [{
//       "num": 1,
//       "block": "Développement",       // libellé du bloc
//       "label": "reprise contrôlée",   // sous-titre optionnel
//       "targetKm": 22,
//       "sessions": [{
//         "id": "s1-mar",               // unique dans le programme
//         "day": 1,                     // 0=Lun 1=Mar 2=Mer 3=Jeu 4=Ven 5=Sam 6=Dim
//         "type": "vma",                // vma | seuil | spe | ef | sl | test | course | renfo | repos
//         "title": "VMA courte",
//         "estKm": 6.2,                 // distance estimée (0 pour renfo/repos)
//         "estMin": 45,                 // durée estimée
//         "optional": false,
//         "segments": [                 // structure de la séance (affichage)
//           { "k": "wu",  "min": 15, "pace": "EF" },
//           { "k": "int", "reps": 8, "dist": 200, "pace": "4:05", "rec": "200 m marche/trot" },
//           { "k": "cd",  "min": 5 }
//         ],
//         "notes": "Sur plat."
//       }]
//     }]
//   }]
// }
// Types de segments : wu (échauffement), cd (retour au calme),
// steady (course continue : min + pace), int (fractionné : reps × dist m @ pace, récup rec),
// strides (n lignes droites), drill (label libre), rest (repos).
// ============================================================

export const SESSION_TYPES = {
  vma:    { label: 'VMA',              color: '#ee4266', xp: 60 },
  seuil:  { label: 'Seuil',            color: '#ff6b35', xp: 60 },
  spe:    { label: 'Allure spécifique',color: '#f7931e', xp: 60 },
  ef:     { label: 'Endurance fondamentale', color: '#0ead69', xp: 40 },
  sl:     { label: 'Sortie longue',    color: '#4361ee', xp: 50 },
  test:   { label: 'Test chrono',      color: '#7209b7', xp: 120 },
  course: { label: 'Course objectif',  color: '#d90429', xp: 200 },
  renfo:  { label: 'Renforcement',     color: '#3bceac', xp: 15 },
  repos:  { label: 'Repos',            color: '#8d99ae', xp: 10 },
};

const RENFO_SEGMENTS = [
  { k: 'drill', label: 'Excentrique mollets : 3×15 montées sur pointes, descente lente (sur une marche)' },
  { k: 'drill', label: 'Tibialis : 3×20 relevés de pointe de pied (talon au sol)' },
  { k: 'drill', label: 'Gainage : planche 3×40 s' },
];
const RENFO_NOTES = 'À faire les jours d’EF ou de repos, jamais juste avant une séance de qualité. Essentiel avec des tibias sensibles.';

function renfo(week, day, n) {
  return {
    id: `s${week}-renfo${n}`, day, type: 'renfo', title: `Renfo tibias & gainage ${n}/2`,
    estKm: 0, estMin: 10, optional: false, segments: RENFO_SEGMENTS, notes: RENFO_NOTES,
  };
}

export const SUB50_PROGRAM = {
  id: 'sub50-10k-v2',
  name: 'Plan 10 km sous 50 min — rectifié',
  objective: '10 km en moins de 50:00',
  startDate: '2026-07-06',
  source: 'plan-sub50-rectifie.pdf',
  description:
    '10 semaines · 4 séances course/sem + 2 renfos · Contrainte : genoux/tibias sensibles (volume prudent, qualité sur plat). '
    + 'Base de départ : VO₂max 53,8 · FC repos ~55 · meilleure allure récente 5:50/km sur 7 km · ~18 km/sem. '
    + 'Règles : jamais 2 séances dures d’affilée (48 h entre chaque) · toute douleur tibiale qui persiste après l’échauffement = repos, pas de qualité · '
    + 'jamais volume ET intensité en plus la même semaine · EF = vraiment lent. Le test 10 km de S5 recale toutes les allures.',
  paces: { 'EF': '6:20–6:40', 'Objectif 10 km': '5:00', 'Seuil': '5:00 → 4:55', 'VMA': '4:05', 'Sortie longue': '6:30' },
  weeks: [
    {
      num: 1, block: 'Bloc 1 — Développement', label: 'reprise contrôlée', targetKm: 22,
      sessions: [
        { id: 's1-mar', day: 1, type: 'vma', title: 'VMA courte 8×200 m', estKm: 6.2, estMin: 42,
          segments: [
            { k: 'wu', min: 15, pace: 'EF' },
            { k: 'int', reps: 8, dist: 200, pace: '4:05', rec: '200 m marche/trot' },
            { k: 'cd', min: 5 },
          ], notes: 'Sur plat, parcours connu.' },
        { id: 's1-jeu', day: 3, type: 'ef', title: 'EF 40 min', estKm: 6.2, estMin: 40,
          segments: [{ k: 'steady', min: 40, pace: '6:30' }], notes: 'En aisance : tu dois pouvoir parler.' },
        { id: 's1-sam', day: 5, type: 'ef', title: 'Footing cadence 35 min', estKm: 5.4, estMin: 35,
          segments: [
            { k: 'drill', label: 'Skipping 2×30 s en début de séance' },
            { k: 'steady', min: 35, pace: 'EF' },
          ] },
        { id: 's1-dim', day: 6, type: 'sl', title: 'Sortie longue 1h05', estKm: 10, estMin: 65,
          segments: [{ k: 'steady', min: 65, pace: '6:30' }], notes: 'Allure très souple.' },
        renfo(1, 2, 1), renfo(1, 4, 2),
      ],
    },
    {
      num: 2, block: 'Bloc 1 — Développement', label: '', targetKm: 24,
      sessions: [
        { id: 's2-mar', day: 1, type: 'seuil', title: 'Seuil 3×1000 m', estKm: 7.0, estMin: 45,
          segments: [
            { k: 'wu', min: 15, pace: 'EF' },
            { k: 'int', reps: 3, dist: 1000, pace: '5:00', rec: '2 min trot' },
            { k: 'cd', min: 5 },
          ], notes: 'Terrain plat et repéré.' },
        { id: 's2-jeu', day: 3, type: 'ef', title: 'EF 45 min', estKm: 6.9, estMin: 45,
          segments: [{ k: 'steady', min: 45, pace: '6:30' }] },
        { id: 's2-sam', day: 5, type: 'ef', title: 'EF 40 min + lignes droites', estKm: 6.4, estMin: 42,
          segments: [
            { k: 'steady', min: 40, pace: 'EF' },
            { k: 'strides', n: 4 },
          ] },
        { id: 's2-dim', day: 6, type: 'sl', title: 'Sortie longue 1h10', estKm: 10.8, estMin: 70,
          segments: [{ k: 'steady', min: 70, pace: '6:30' }] },
        renfo(2, 2, 1), renfo(2, 4, 2),
      ],
    },
    {
      num: 3, block: 'Bloc 1 — Développement', label: '', targetKm: 26,
      sessions: [
        { id: 's3-mar', day: 1, type: 'vma', title: 'VMA 10×300 m', estKm: 7.4, estMin: 48,
          segments: [
            { k: 'wu', min: 15, pace: 'EF' },
            { k: 'int', reps: 10, dist: 300, pace: '4:05', rec: '1 min' },
            { k: 'cd', min: 5 },
          ], notes: 'Sur plat.' },
        { id: 's3-jeu', day: 3, type: 'ef', title: 'EF 45 min', estKm: 6.9, estMin: 45,
          segments: [{ k: 'steady', min: 45, pace: '6:30' }] },
        { id: 's3-sam', day: 5, type: 'ef', title: 'EF 45 min', estKm: 6.9, estMin: 45,
          segments: [{ k: 'steady', min: 45, pace: '6:30' }] },
        { id: 's3-dim', day: 6, type: 'sl', title: 'Sortie longue 1h15', estKm: 11.5, estMin: 75,
          segments: [{ k: 'steady', min: 75, pace: '6:30' }] },
        renfo(3, 2, 1), renfo(3, 4, 2),
      ],
    },
    {
      num: 4, block: 'Bloc 1 — Développement', label: 'allègement · assimilation', targetKm: 20,
      sessions: [
        { id: 's4-mar', day: 1, type: 'seuil', title: 'Seuil léger 2×1200 m', estKm: 6.1, estMin: 40,
          segments: [
            { k: 'wu', min: 15, pace: 'EF' },
            { k: 'int', reps: 2, dist: 1200, pace: '5:00', rec: '2 min' },
            { k: 'cd', min: 5 },
          ] },
        { id: 's4-jeu', day: 3, type: 'ef', title: 'EF 35 min', estKm: 5.4, estMin: 35,
          segments: [{ k: 'steady', min: 35, pace: '6:30' }] },
        { id: 's4-sam', day: 5, type: 'ef', title: 'Repos ou EF très court 30 min', estKm: 4.6, estMin: 30, optional: true,
          segments: [{ k: 'steady', min: 30, pace: 'EF' }], notes: 'Optionnelle : écoute tes tibias.' },
        { id: 's4-dim', day: 6, type: 'sl', title: 'Sortie longue 1h00 souple', estKm: 9.2, estMin: 60,
          segments: [{ k: 'steady', min: 60, pace: '6:30' }] },
        renfo(4, 2, 1), renfo(4, 4, 2),
      ],
    },
    {
      num: 5, block: 'Test', label: 'Test 10 km — recalage des allures', targetKm: 20,
      sessions: [
        { id: 's5-mar', day: 1, type: 'ef', title: 'EF 30 min + 3 lignes droites', estKm: 5.0, estMin: 32,
          segments: [
            { k: 'steady', min: 30, pace: 'EF' },
            { k: 'strides', n: 3 },
          ] },
        { id: 's5-jeu', day: 3, type: 'repos', title: 'Repos complet', estKm: 0, estMin: 0,
          segments: [{ k: 'rest' }], notes: 'Fraîcheur maximale avant le test.' },
        { id: 's5-sam', day: 5, type: 'test', title: 'TEST 10 km chronométré', estKm: 12, estMin: 55,
          segments: [
            { k: 'wu', min: 10, pace: 'EF' },
            { k: 'steady', min: 52, pace: '5:05–5:10 puis accélère', label: '10 km chrono' },
          ],
          notes: 'Plat, parcours connu. Pars prudent (5:05–5:10 les 3 premiers km) puis accélère si tu peux. Le résultat sert à recaler toutes les allures des blocs suivants.' },
        { id: 's5-dim', day: 6, type: 'ef', title: 'Récupération 40 min très souple', estKm: 6.0, estMin: 40,
          segments: [{ k: 'steady', min: 40, pace: '6:40+' }] },
        renfo(5, 2, 1),
      ],
    },
    {
      num: 6, block: 'Bloc 2 — Spécifique', label: '', targetKm: 26,
      sessions: [
        { id: 's6-mar', day: 1, type: 'spe', title: 'Allure spécifique 4×1000 m', estKm: 8.3, estMin: 50,
          segments: [
            { k: 'wu', min: 15, pace: 'EF' },
            { k: 'int', reps: 4, dist: 1000, pace: '5:00', rec: '90 s trot' },
            { k: 'cd', min: 5 },
          ], notes: 'Allures recalées après le test de S5 si besoin.' },
        { id: 's6-jeu', day: 3, type: 'ef', title: 'EF 45 min', estKm: 6.9, estMin: 45,
          segments: [{ k: 'steady', min: 45, pace: '6:30' }] },
        { id: 's6-sam', day: 5, type: 'ef', title: 'EF 40 min + skipping', estKm: 6.2, estMin: 42,
          segments: [
            { k: 'steady', min: 40, pace: 'EF' },
            { k: 'drill', label: 'Skipping' },
          ] },
        { id: 's6-dim', day: 6, type: 'sl', title: 'Sortie longue 1h15', estKm: 11.5, estMin: 75,
          segments: [{ k: 'steady', min: 75, pace: '6:30' }] },
        renfo(6, 2, 1), renfo(6, 4, 2),
      ],
    },
    {
      num: 7, block: 'Bloc 2 — Spécifique', label: '', targetKm: 29,
      sessions: [
        { id: 's7-mar', day: 1, type: 'seuil', title: 'Seuil 3×1500 m', estKm: 8.5, estMin: 52,
          segments: [
            { k: 'wu', min: 15, pace: 'EF' },
            { k: 'int', reps: 3, dist: 1500, pace: '4:55', rec: '2 min' },
            { k: 'cd', min: 5 },
          ] },
        { id: 's7-jeu', day: 3, type: 'ef', title: 'EF 45 min', estKm: 6.9, estMin: 45,
          segments: [{ k: 'steady', min: 45, pace: '6:30' }] },
        { id: 's7-sam', day: 5, type: 'ef', title: 'EF 45 min', estKm: 6.9, estMin: 45,
          segments: [{ k: 'steady', min: 45, pace: '6:30' }] },
        { id: 's7-dim', day: 6, type: 'sl', title: 'Sortie longue 1h20', estKm: 12.3, estMin: 80,
          segments: [{ k: 'steady', min: 80, pace: '6:30' }] },
        renfo(7, 2, 1), renfo(7, 4, 2),
      ],
    },
    {
      num: 8, block: 'Bloc 2 — Spécifique', label: 'pic de volume', targetKm: 32,
      sessions: [
        { id: 's8-mar', day: 1, type: 'spe', title: 'Spécifique 2×2000 m', estKm: 8.0, estMin: 50,
          segments: [
            { k: 'wu', min: 15, pace: 'EF' },
            { k: 'int', reps: 2, dist: 2000, pace: 'allure 10 km', rec: '3 min' },
            { k: 'cd', min: 5 },
          ] },
        { id: 's8-jeu', day: 3, type: 'ef', title: 'EF 50 min', estKm: 7.7, estMin: 50,
          segments: [{ k: 'steady', min: 50, pace: '6:30' }] },
        { id: 's8-sam', day: 5, type: 'ef', title: 'EF 40 min + 5 lignes droites', estKm: 6.4, estMin: 42,
          segments: [
            { k: 'steady', min: 40, pace: 'EF' },
            { k: 'strides', n: 5 },
          ] },
        { id: 's8-dim', day: 6, type: 'sl', title: 'Sortie longue 1h25', estKm: 13.1, estMin: 85,
          segments: [{ k: 'steady', min: 85, pace: '6:30' }] },
        renfo(8, 2, 1), renfo(8, 4, 2),
      ],
    },
    {
      num: 9, block: 'Bloc 2 — Spécifique', label: 'assimilation', targetKm: 26,
      sessions: [
        { id: 's9-mar', day: 1, type: 'vma', title: 'VMA d’entretien 6×300 m', estKm: 5.8, estMin: 38,
          segments: [
            { k: 'wu', min: 15, pace: 'EF' },
            { k: 'int', reps: 6, dist: 300, pace: '4:05', rec: '1 min' },
            { k: 'cd', min: 5 },
          ] },
        { id: 's9-jeu', day: 3, type: 'ef', title: 'EF 40 min', estKm: 6.2, estMin: 40,
          segments: [{ k: 'steady', min: 40, pace: '6:30' }] },
        { id: 's9-sam', day: 5, type: 'ef', title: 'Repos ou EF 30 min', estKm: 4.6, estMin: 30, optional: true,
          segments: [{ k: 'steady', min: 30, pace: 'EF' }] },
        { id: 's9-dim', day: 6, type: 'sl', title: 'Sortie longue 1h05', estKm: 10.0, estMin: 65,
          segments: [{ k: 'steady', min: 65, pace: '6:30' }] },
        renfo(9, 2, 1), renfo(9, 4, 2),
      ],
    },
    {
      num: 10, block: 'Bloc 3 — Affûtage', label: 'objectif !', targetKm: 18,
      sessions: [
        { id: 's10-mar', day: 1, type: 'vma', title: 'Réveil 5×200 m', estKm: 5.1, estMin: 34,
          segments: [
            { k: 'wu', min: 15, pace: 'EF' },
            { k: 'int', reps: 5, dist: 200, pace: '4:05', rec: '200 m' },
            { k: 'cd', min: 5 },
          ] },
        { id: 's10-jeu', day: 3, type: 'ef', title: 'EF 30 min très souple', estKm: 4.6, estMin: 30,
          segments: [{ k: 'steady', min: 30, pace: '6:40+' }] },
        { id: 's10-ven', day: 4, type: 'repos', title: 'Repos complet', estKm: 0, estMin: 0,
          segments: [{ k: 'rest' }] },
        { id: 's10-obj', day: 5, type: 'course', title: '🏆 10 KM OBJECTIF — SUB 50', estKm: 10, estMin: 50,
          segments: [
            { k: 'steady', min: 15, pace: '5:05', label: 'km 1–3 : 5:05/km, pars prudent' },
            { k: 'steady', min: 20, pace: '5:00', label: 'km 4–7 : 5:00/km, cale-toi' },
            { k: 'steady', min: 15, pace: 'à fond', label: 'km 8–10 : tout ce qui reste' },
          ],
          notes: 'Plat. Samedi ou dimanche. Cible finale : sous 50:00. Tu as fait le travail — fais-toi confiance.' },
        renfo(10, 2, 1),
      ],
    },
  ],
};

// Validation minimale d'un programme importé
export function validateProgram(p) {
  const errors = [];
  if (!p.id) errors.push('id manquant');
  if (!p.name) errors.push('name manquant');
  if (!Array.isArray(p.weeks) || !p.weeks.length) errors.push('weeks manquant ou vide');
  const ids = new Set();
  for (const w of p.weeks || []) {
    if (typeof w.num !== 'number') errors.push(`semaine sans num`);
    for (const s of w.sessions || []) {
      if (!s.id) errors.push(`séance sans id (semaine ${w.num})`);
      else if (ids.has(s.id)) errors.push(`id de séance en double : ${s.id}`);
      ids.add(s.id);
      if (s.day == null || s.day < 0 || s.day > 6) errors.push(`day invalide pour ${s.id} (0=Lun … 6=Dim)`);
      if (!SESSION_TYPES[s.type]) errors.push(`type inconnu « ${s.type} » pour ${s.id}`);
    }
  }
  return errors;
}
