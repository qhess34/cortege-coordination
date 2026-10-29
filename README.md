# Coordination de cortège

Application web de préparation du parcours d'une manifestation sur la voie publique et de coordination des équipes
d'encadrement : import du parcours GPX, analyse du réseau viaire OpenStreetMap, points de mission, équipes et
missions ordonnées. Une application mobile de terrain (PWA) et les invitations par QR code ou lien suivront.

![Interface organisateur](docs/apercu-organisateur.png)

*Capture prise dans l'environnement de test, sans accès aux tuiles : en usage réel, le fond de carte OSM s'affiche
sous le tracé.*

> **Avertissement.** Les points proposés à partir d'OpenStreetMap sont des **suggestions à vérifier**. Les données
> OSM peuvent être incomplètes ou obsolètes et ne constituent pas une source officielle sur les arrêtés,
> autorisations, fermetures ou conditions de circulation. L'application ne garantit pas la sécurité d'un parcours,
> n'autorise pas la fermeture d'une voie et ne remplace ni les autorités compétentes, ni les procédures officielles,
> ni les services d'urgence.

## État d'avancement

| Phase | Contenu | État |
|---|---|---|
| 1 — Prototype cartographique | Événements, GPX, carte, analyse OSM, suggestions, points, nouvelle analyse non destructive, équipes, missions ordonnées | **Fait** |
| 2 — Comptes et invitations | Administration des comptes (API faite, écran à faire), QR code, magic link, admission, sessions des participants | À faire |
| 3 — Coordination mobile | PWA, vue de mission, routage piéton, temps réel, messages, incidents | À faire |
| 4 — Fonctions avancées | Partage GPS facultatif, hors ligne, relèves avancées, exports | À faire |

La conception complète (architecture, modèle de données, écrans, flux d'invitation, risques) est dans
[docs/CONCEPTION.md](docs/CONCEPTION.md).

## Ce que fait la phase 1

- **Comptes administrés** : pas d'inscription publique. Le premier administrateur est créé en ligne de commande ;
  les administrateurs créent les autres comptes (`POST /api/admin/users`, écran prévu en phase 2).
- **Événements** isolés : chaque compte ne voit que ceux auxquels il a accès ; un administrateur voit tout.
- **Parcours GPX** : validation, longueur, distances cumulées, boucles, segments disjoints, sauts suspects, points
  de passage ; remplacement versionné avec aperçu des points qui s'éloigneraient du nouveau tracé, confirmation,
  et aucune suppression.
- **Analyse OSM** (via Overpass) : connexions réelles par nœud partagé (un pont ou un tunnel qui croise le
  parcours n'est pas une intersection), sens uniques y compris inversés et giratoires, accès et restrictions par
  type de véhicule, restrictions temporelles, restrictions de tournant, voies privées, piétonnes et cyclables,
  regroupement des nœuds d'un même carrefour, passages multiples sur les boucles. Chaque suggestion indique son
  motif, ses voies, ses attributs OSM, ses incertitudes et une pertinence estimée.
- **Nouvelle analyse non destructive** : identifiant stable par nœud OSM (avec repli sur la voie et la position),
  suggestions écartées mémorisées, modifications OSM présentées à part et appliquées seulement sur décision,
  doublons possibles avec des points existants signalés, suggestions disparues conservées et signalées.
- **Points de mission** : ajout par clic (plusieurs à la suite) ou par coordonnées, déplacement à la souris,
  modification, distance cumulée calculée ou fixée à la main, suppression avec présentation des conséquences,
  recherche, filtres, historique.
- **Équipes et missions** : création, couleur, responsable, consignes, désactivation ; affectation ordonnée,
  réordonnancement, réaffectation, statuts de mission avec transitions contrôlées (la fin d'une mission ne libère
  pas le point).
- **Fonds de carte** au choix (mémorisé dans le navigateur) : plan OpenStreetMap, plan IGN, photo aérienne IGN
  (France), satellite Esri (monde).
- **Photos de rue Panoramax** : un clic sur la carte (hors mode ajout) ouvre la photo
  [Panoramax](https://panoramax.fr) la plus proche (à moins de 50 m) dans le viewer officiel, pour vérifier un
  carrefour ou un accès sans se déplacer ; un clic sur un point ou une suggestion montre la photo la plus proche de
  cet élément. La couverture photo est tracée en orange à partir du zoom 13. Désactivable dans la barre de la carte
  (« Photos Panoramax au clic »). Une photo peut être ancienne : elle ne reflète pas forcément l'état actuel.
- **Synthèse** : points validés sans équipe, répartition des statuts, analyse à relancer après changement de
  parcours.

## Démarrage rapide (développement)

Prérequis : Node.js 20 ou plus, PostgreSQL 16 avec PostGIS 3 (ou Docker).

```bash
cp .env.example .env    # puis adapter les valeurs
npm install
docker compose up -d db # ou une base PostGIS locale
npm run migrate
npm run admin:create -- admin "Administrateur"
npm run dev:server      # API sur http://127.0.0.1:3000
npm run dev:web         # interface sur http://127.0.0.1:5173
```

Les scripts lisent les variables d'environnement : chargez `.env` dans votre shell (par exemple
`set -a; . ./.env; set +a`).

## Auto-hébergement avec Docker Compose

```bash
cp .env.example .env    # définir au minimum POSTGRES_PASSWORD
docker compose up -d --build
docker compose exec app node server/dist/cli/create-admin.js admin "Administrateur"
```

L'application écoute sur `127.0.0.1:3000` ; placez-la derrière un proxy HTTPS (Caddy, nginx…). Les cookies de
session sont `Secure` par défaut dans ce mode (`COOKIE_SECURE=true`) : sans HTTPS, la connexion échouera.

### Sauvegarde et restauration

```bash
docker compose exec -T db pg_dump -U cortege -Fc cortege > sauvegarde-$(date +%F).dump
```

```bash
docker compose exec -T db pg_restore -U cortege -d cortege --clean --if-exists < sauvegarde-AAAA-MM-JJ.dump
```

Testez la restauration sur une base vide avant le jour de l'événement.

## Tests

```bash
npm test               # serveur (unitaires + intégration PostGIS) et interface
npm run typecheck
npx playwright test    # bout en bout dans Chromium (base cortege_e2e, faux serveur Overpass)
```

Les tests d'intégration utilisent une **vraie base PostGIS** désignée par `TEST_DATABASE_URL`
(par défaut `postgres://cortege:cortege@localhost:5432/cortege_test`), entièrement **réinitialisée** à chaque
exécution. Le test de bout en bout utilise `E2E_DATABASE_URL` (par défaut `cortege_e2e`). Aucun test n'appelle
les services OSM : le réseau OSM des tests est construit dans `server/test/helpers/osm.ts`.

## Configuration

| Variable | Rôle | Défaut |
|---|---|---|
| `DATABASE_URL` | Connexion PostgreSQL | — (obligatoire) |
| `PORT`, `HOST` | Écoute du serveur | `3000`, `127.0.0.1` |
| `COOKIE_SECURE` | Cookies réservés à HTTPS | `true` en production |
| `SESSION_TTL_HOURS` | Durée des sessions (glissante) | `12` |
| `OVERPASS_URL` | Instance Overpass | `https://overpass-api.de/api/interpreter` |
| `OSM_USER_AGENT` | Identification envoyée à Overpass | `cortege-coordination (auto-hébergé)` |
| `MAX_GPX_BYTES` | Taille maximale d'un GPX | 10 Mo |
| `WEB_DIST` | Dossier de l'interface compilée servie par l'API | — |
| `VITE_TILE_URL` | Modèle d'URL des tuiles (à la compilation de l'interface) | tuiles OSM |
| `VITE_SATELLITE_URL`, `VITE_SATELLITE_ATTRIBUTION` | Autre fournisseur pour le fond « Satellite » | Esri World Imagery |
| `VITE_PANORAMAX_URL` | API Panoramax (recherche, tuiles de couverture, viewer) | `https://api.panoramax.xyz/api` |

## OpenStreetMap : licences et limites d'usage

- Les données OSM sont sous licence [ODbL](https://www.openstreetmap.org/copyright) : l'attribution
  « © contributeurs OpenStreetMap » est affichée en permanence sur la carte.
- **Overpass** (`overpass-api.de`) est un service public gratuit, sans garantie, limité à quelques requêtes par
  minute et par adresse. L'application n'envoie qu'une requête par analyse, restreinte à un couloir de 40 m autour
  du parcours, et conserve les résultats. Pour un usage régulier : instance Overpass auto-hébergée sur un extrait
  régional (Geofabrik), puis `OVERPASS_URL`.
- **Tuiles** `tile.openstreetmap.org` : soumises à la [politique d'usage](https://operations.osmfoundation.org/policies/tiles/)
  de la fondation OSM (usage modéré, pas de téléchargement massif). Pour un usage soutenu : fournisseur commercial
  ou tuiles auto-hébergées (Protomaps/PMTiles, OpenMapTiles), puis `VITE_TILE_URL`.
  Ces serveurs refusent (403) les requêtes sans en-tête `Referer` : l'application envoie donc l'origine du site
  (`Referrer-Policy: strict-origin-when-cross-origin`). Si le plan OSM reste bloqué, choisissez le plan IGN.
- **IGN Géoplateforme** (plan IGN, photo aérienne) : service public sans clé, données sous Licence Ouverte Etalab,
  couverture France ; attribution « © IGN » affichée.
- **Esri World Imagery** (satellite) : soumis aux [conditions d'Esri](https://www.esri.com/en-us/legal/terms/full-master-agreement)
  (attribution obligatoire, usage à vérifier selon votre contexte). Remplaçable par `VITE_SATELLITE_URL`.
- **Panoramax** : photos de rue libres (licences indiquées par le viewer, le plus souvent CC-BY-SA). Le navigateur
  interroge directement l'instance configurée (`VITE_PANORAMAX_URL`) : la position cliquée lui est donc transmise.
  Une instance Panoramax auto-hébergée peut être utilisée.
- **Routage piéton** (phase 3) : OSRM ou Valhalla auto-hébergés ; les serveurs de démonstration ne sont pas faits
  pour la production.

## Sécurité (phase 1)

- Aucune route d'inscription ; création et rôles des comptes réservés aux administrateurs.
- Mots de passe hachés avec scrypt ; sessions par cookie `HttpOnly`, `SameSite=Lax`, `Secure` en production ;
  seul le hash SHA-256 du jeton est stocké ; révocation à la déconnexion, à la désactivation du compte ou au
  changement de mot de passe.
- Toutes les permissions sont vérifiées côté serveur ; un événement inaccessible répond 404.
- En-tête `X-Requested-With` exigé sur toute requête modifiante (protection CSRF en plus de `SameSite`).
- Limitation des tentatives de connexion (par adresse et par identifiant).
- Verrou optimiste (`version`) sur les événements, points, équipes et missions : pas d'écrasement silencieux.
- Journal d'audit des modifications importantes, sans secret.

## Structure du dépôt

```
server/            API Fastify (TypeScript)
  migrations/      schéma SQL versionné (PostGIS)
  src/geo/         calculs purs : parcours, GPX, analyse OSM
  src/routes/      routes HTTP, une par domaine
  src/services/    fusion des analyses, missions, Overpass
  test/            tests unitaires et d'intégration
web/               interface React + Vite + MapLibre
e2e/               test de bout en bout Playwright
docs/              conception et captures
```

## Limites connues

- L'analyse OSM n'a été validée que sur des réseaux synthétiques : à confronter à de vrais parcours (le résultat
  dépend de la qualité du tracé GPX et des données OSM locales). Les seuils (15 m, 35°, 25 m) sont réglables.
- Les grands carrefours à chaussées séparées peuvent produire plusieurs suggestions voisines ; le regroupement se
  fait à 25 m.
- Pas encore d'écran d'administration des comptes, ni de membres d'équipe (phase 2) : le responsable d'équipe est
  choisi parmi les comptes ayant accès à l'événement.
- Le compteur de tentatives de connexion est en mémoire (une seule instance du serveur).
