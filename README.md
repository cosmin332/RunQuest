# 🏃‍♂️ RunQuest — objectif sub 50

PWA d'entraînement course à pied : programmes séance par séance, validation liée à tes
activités Strava/Santé, stats avancées (charge, ACWR, VO₂max, efficacité aérobie, records,
projections Riegel), gamification complète (XP, niveaux, badges, streaks).
100 % statique, 100 % local : aucune donnée ne quitte ton appareil.

## Démarrage rapide

1. **Héberger sur GitHub Pages**
   ```bash
   cd runquest
   git remote add origin https://github.com/<ton-pseudo>/runquest.git
   git push -u origin main
   ```
   Puis sur GitHub : *Settings → Pages → Source : Deploy from a branch → main / root*.
   L'app sera sur `https://<ton-pseudo>.github.io/runquest/`.

2. **Installer sur iPhone** : ouvre l'URL dans Safari → Partager → *Sur l'écran d'accueil*.

3. **Charger tes données** : Réglages → *Restaurer une sauvegarde* → choisis
   `runquest-donnees-initiales.json` (fourni à côté de ce dossier : il contient déjà
   ton archive Strava, ton export Santé, ton ancien programme runtrack et le plan sub-50).
   ⚠️ **Ne committe jamais ce fichier dans le repo public** : il contient tes données
   perso et ton Client Secret Strava.

## Imports supportés (Réglages)

| Source | Fichier | Contenu |
|---|---|---|
| App Santé iPhone | JSON « Health Auto Export » | workouts + FC, VO₂max, FC repos, HRV, sommeil, poids, puissance, foulée… |
| Archive Strava | `activities.csv` de l'export d'archive | résumé de toutes les activités |
| GPX | fichiers `.gpx` (multi-sélection) | trace + FC |
| API Strava | OAuth (Client ID/Secret dans Réglages) | sync incrémentale des nouvelles activités |
| Ancienne app | sauvegarde runtrack `.json` | programme précédent + historique |

Les activités des différentes sources sont **automatiquement dédupliquées et fusionnées** :
deux enregistrements dont les plages horaires se chevauchent majoritairement (montre +
téléphone, Strava + Santé…) deviennent une seule activité, champs complétés entre sources ;
des segments consécutifs sans chevauchement restent distincts. Une passe de nettoyage
tourne aussi **à chaque démarrage** et après chaque import/sync (bouton manuel
« 🧹 Dédupliquer » dans Réglages). Les séances de programme liées à une activité absorbée
sont automatiquement re-liées à l'activité conservée.

### Sync Strava (API)

1. Crée une app sur <https://www.strava.com/settings/api>.
2. *Authorization Callback Domain* = ton domaine GitHub Pages (ex. `ton-pseudo.github.io`).
3. Colle Client ID + Client Secret dans Réglages → *Connecter mon compte Strava*.

## Format d'import de programme

Bouton **❓ Format** dans l'onglet Programme (exemple téléchargeable). Résumé :

```json
{
  "formatVersion": 1,
  "programs": [{
    "id": "unique", "name": "Nom", "objective": "…", "startDate": "2026-09-07",
    "paces": { "EF": "6:20" },
    "weeks": [{
      "num": 1, "block": "Bloc 1", "label": "", "targetKm": 30,
      "sessions": [{
        "id": "w1-mar", "day": 1, "type": "seuil", "title": "Seuil 3×1000 m",
        "estKm": 7, "estMin": 45, "optional": false,
        "segments": [
          { "k": "wu", "min": 15, "pace": "EF" },
          { "k": "int", "reps": 3, "dist": 1000, "pace": "5:10", "rec": "2 min trot" },
          { "k": "cd", "min": 5 }
        ],
        "notes": "Sur plat."
      }]
    }]
  }]
}
```

- `day` : 0=Lun … 6=Dim · `type` : `vma` `seuil` `spe` `ef` `sl` `test` `course` `renfo` `repos`
- segments : `wu`/`cd` (échauffement/RC), `int` (fractionné), `steady` (continu),
  `strides` (lignes droites), `drill` (exercice libre), `rest` (repos)

Donne ce format à ton coach (ou à Claude) pour générer tes futurs plans : import en un clic.

## Sauvegarde

Réglages → *Exporter la sauvegarde* : un JSON complet (activités, métriques, programmes,
avancement, XP, badges, réglages). *Restaurer* recharge tout à l'identique.
À faire régulièrement — c'est ton filet de sécurité.

## Développement

- Zéro build : HTML/CSS/JS modules natifs + Chart.js vendorisé.
- Stockage : IndexedDB (activités, métriques) + localStorage (état/programmes).
- Serveur local : `node .claude/serve.mjs runquest 8474` depuis le dossier parent,
  ou n'importe quel serveur statique.
- **Après toute modif des fichiers, incrémente `CACHE` dans `sw.js`** (ex. `runquest-v2`)
  pour que les PWA installées se mettent à jour.

## Architecture

```
index.html            shell + nav
css/app.css           thème sport clair
js/app.js             routeur, init, badges, callback OAuth
js/db.js              IndexedDB + localStorage + sauvegarde globale
js/parsers.js         CSV Strava, GPX, Santé, runtrack + fusion multi-sources
js/data-import.js     ingestion : fusion + dédup + re-liaison des séances
js/program-data.js    plan sub-50 encodé + format & validation d'import
js/analytics.js       volume, TRIMP, ACWR, records, Riegel/VDOT, zones FC, efficacité
js/gamification.js    XP (recalcul déterministe), niveaux, badges, streaks
js/strava.js          OAuth + sync API
js/charts.js          thème Chart.js
js/views/*.js         Dashboard, Programme, Activités, Stats, Progrès, Réglages
```
