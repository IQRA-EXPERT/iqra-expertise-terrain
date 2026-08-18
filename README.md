# IQRA Expertise — Application de collecte terrain

Application web pour la collecte de données terrain (expertise immobilière) par les agents,
avec traitement et génération de rapport par l'expert. Backend Node.js + Express + SQLite,
frontend HTML/JS natif (fonctionne sur ordinateur, tablette et téléphone).

## Ce qui fonctionne réellement dans cette version

- Réquisition à Expert (ordre de mission) — l'agent ne peut pas démarrer de visite sans elle
- Fiche de mission terrain complète (relevés, titre foncier, nature/état/VRD, annexes)
- **Géolocalisation GPS réelle** avec conversion automatique en coordonnées **UTM (WGS84)**
- **Appareil photo réel** (ouvre la caméra du téléphone via `capture="environment"`)
- Galerie de photos avec suppression, mention "Images IQRA-EXPERT"
- **Suivi GPS du trajet** en continu avec calcul de distance parcourue
- Chronologie de mission (début / arrivée / fin) avec temps total écoulé
- Section "Indicateur de terrain" **obligatoire** — bloque l'envoi si non renseignée
- Aperçu avant envoi, impression/export PDF (via l'impression du navigateur)
- Espace expert : réception, modification illimitée, génération de rapport
- Base de données SQLite réelle (fichier `data/iqra.db`) — les données persistent
- **Authentification par compte** (identifiant + mot de passe, mots de passe hachés avec
  `scrypt`, sessions serveur) — l'expert crée et désactive les comptes agent depuis l'app ;
  un compte expert est créé automatiquement au premier démarrage (voir logs du serveur)

## Ce qui reste à faire pour un déploiement en production

1. **Mode hors-ligne** : cette version nécessite une connexion réseau au serveur.
   Un vrai mode hors-ligne avec synchronisation demande soit une application mobile native,
   soit un Service Worker (PWA) avec stockage local puis synchronisation.
2. **Envoi d'email réel** : le code est prêt (`nodemailer`), il suffit de renseigner
   `.env` avec un compte Gmail et un "mot de passe d'application" (voir `.env.example`).
3. **Génération Word/Excel** : actuellement le rapport s'exporte en PDF via impression navigateur.
   Pour générer automatiquement les modèles ICRA-SARL (Word 12 sections + Excel
   PARAMETRES/DEVIS/SYNTHESE), il faut ajouter une librairie comme `docx` ou `exceljs`
   et adapter la génération à vos modèles exacts.
4. **Hébergement** — voir section dédiée ci-dessous. **Obligatoire** pour que le GPS et la
   caméra fonctionnent sur mobile (ils exigent HTTPS hors `localhost`).

## Installation et démarrage (en local)

```bash
npm install
cp .env.example .env
npm start
```

Puis ouvrez `http://localhost:3000` dans votre navigateur. Au premier démarrage, un compte
expert est créé automatiquement et ses identifiants sont affichés **une seule fois** dans les
logs du serveur (notez-les immédiatement). Définissez `EXPERT_USERNAME`/`EXPERT_PASSWORD` dans
`.env` avant le premier démarrage si vous préférez choisir vous-même ces identifiants.

## Configuration (`.env`)

```bash
cp .env.example .env
# puis éditez .env avec vos identifiants
```

Variables : `SMTP_USER`/`SMTP_PASS`/`EXPERT_EMAIL` (notifications par email, facultatif),
`SESSION_SECRET` (obligatoire en production — clé de signature des sessions),
`EXPERT_USERNAME`/`EXPERT_PASSWORD` (compte expert initial), `NODE_ENV=production` une fois
déployé derrière HTTPS.

## Déploiement en ligne (Railway ou Render)

L'app est un serveur Node.js classique (`npm start`, écoute sur `process.env.PORT`) — elle se
déploie telle quelle sur Railway ou Render, sans configuration supplémentaire.

**⚠️ Le disque de ces hébergeurs (offre gratuite) n'est pas persistant** : la base SQLite
(`data/iqra.db`) et les photos (`uploads/`) seraient effacées à chaque redéploiement. Pour un
usage réel, activez un volume persistant (Railway : "Volumes" ; Render : "Disks", payant sur
Render) monté sur `/data` et `/uploads`, ou migrez vers une base gérée plus tard.

Étapes générales (identiques sur les deux plateformes) :

1. Poussez ce dépôt sur GitHub (`git push`).
2. Sur [railway.app](https://railway.app) ou [render.com](https://render.com), créez un nouveau
   service "Web Service" à partir de ce dépôt GitHub.
3. Build command : `npm install` — Start command : `npm start` (détecté automatiquement).
4. Renseignez les variables d'environnement du service (mêmes clés que `.env.example`) :
   `SESSION_SECRET` (obligatoire), `EXPERT_USERNAME`, `EXPERT_PASSWORD`, `NODE_ENV=production`,
   et éventuellement `SMTP_USER`/`SMTP_PASS`/`EXPERT_EMAIL`.
5. Ajoutez un volume persistant monté sur le dossier du projet (ou au moins sur `data/` et
   `uploads/`) si l'offre le permet.
6. Déployez. L'URL HTTPS fournie par la plateforme est utilisable directement sur mobile pour
   le GPS et la caméra.

## Structure du projet

```
iqra-app/
├── server.js          # Serveur Express + API + base de données
├── package.json
├── .env.example        # Modèle de configuration email
├── data/                # Base de données SQLite (créée automatiquement)
├── uploads/             # Photos envoyées par les agents (créé automatiquement)
└── public/
    ├── index.html
    ├── style.css
    └── app.js            # Toute la logique de l'application
```

## Support

Pour la suite (authentification, mode hors-ligne natif, export Word/Excel,
déploiement), il est recommandé d'utiliser Claude Code pour poursuivre le
développement directement sur ce projet.
