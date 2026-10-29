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
| 2 — Comptes et invitations | Écran d'administration des comptes, accès par manifestation, QR code d'équipe, liens individuels, admission immédiate ou validée, sessions des participants, récupération d'accès | **Fait** |
| 3 — Coordination mobile | Application terrain installable (PWA), vue de mission, statuts posés par les membres, itinéraire piéton, direct (WebSocket), tableau de coordination, messages, incidents, progression déclarée | **Fait** |
| 4 — Fonctions avancées | Partage GPS facultatif, hors ligne, relèves avancées, exports | À faire |

La conception complète (architecture, modèle de données, écrans, flux d'invitation, risques) est dans
[docs/CONCEPTION.md](docs/CONCEPTION.md).

## Ce que fait la phase 1

- **Comptes administrés** : pas d'inscription publique. Le premier administrateur est créé en ligne de commande ;
  les administrateurs créent les autres comptes (écran « Comptes », réservé aux administrateurs).
- **Événements** isolés : chaque compte ne voit que ceux auxquels il a accès ; un administrateur voit tout.
  La barre du haut permet de basculer d'une manifestation à l'autre et d'en créer une nouvelle ; un organisateur
  peut supprimer définitivement une manifestation depuis sa synthèse (nom à retaper, impossible pendant
  l'événement ; seule une trace de la suppression est conservée dans le journal).
- **Parcours GPX** : validation, longueur, distances cumulées, boucles, segments disjoints, sauts suspects, points
  de passage ; remplacement versionné avec aperçu des points qui s'éloigneraient du nouveau tracé, confirmation,
  et aucune suppression.
- **Analyse OSM** (via Overpass) : connexions réelles par nœud partagé (un pont ou un tunnel qui croise le
  parcours n'est pas une intersection), sens uniques y compris inversés et giratoires, accès et restrictions par
  type de véhicule, restrictions temporelles, restrictions de tournant, voies privées, piétonnes et cyclables,
  regroupement des nœuds d'un même carrefour, passages multiples sur les boucles. Chaque suggestion indique son
  motif, ses voies, ses attributs OSM, ses incertitudes et une pertinence estimée.
- **Un point par accès entrant** (par défaut) : pour chaque carrefour, un point est proposé sur chaque côté d'où
  l'on peut arriver sur le parcours (une rue à double sens qui traverse le cortège donne deux points, au nord et au
  sud par exemple), placé à 20 m dans la rue, avec son côté. Un accès en sens unique sortant n'a pas de point.
  Option « un point par carrefour » pour revenir à un seul point au centre de chaque carrefour. Un carrefour écarté
  dans l'ancien mode n'est pas reproposé par ses accès.
- **Options d'analyse**, reprises d'une analyse à l'autre : un point par accès ou par carrefour, accès piétons et
  cyclables, et **rues sortantes** (sens unique depuis le parcours ; non proposées par défaut). Les rues sortantes
  déjà proposées peuvent être écartées en une fois ; elles ne réapparaissent pas.
- **Nouvelle analyse non destructive** : identifiant stable par nœud OSM (avec repli sur la voie et la position),
  suggestions écartées mémorisées, modifications OSM présentées à part et appliquées seulement sur décision,
  doublons possibles avec des points existants signalés, suggestions disparues conservées et signalées.
- **Points de mission, édités directement sur la carte** : en mode ajout, un clic place un point provisoire et ouvre
  sa bulle (nom, type, description) ; il n'est créé qu'à la validation, et un nouveau clic le déplace. Un clic sur un
  point existant ouvre la même bulle : renommer, changer le type, enregistrer, annuler ou supprimer. Pour
  **déplacer** un point, faites-le glisser directement : sa bulle s'ouvre avec « position modifiée », puis
  « Enregistrer » (ou « Annuler » pour le remettre en place) (conséquences présentées si le point est affecté). Le nom affiché sur la carte suit la saisie.
  Le panneau latéral garde la liste, la recherche, les filtres, l'historique et le placement par coordonnées.
- **Équipes sur la carte** : la bulle d'un point permet de l'affecter à une ou plusieurs équipes (ou de l'en
  retirer) ; pour un nouveau point, l'équipe se choisit avant l'ajout. Chaque point prend la couleur de son équipe
  (pastille partagée s'il en a plusieurs, gris sans équipe). Une légende liste les équipes avec leur nombre de points
  et permet de masquer ou d'afficher les points de chacune.
- **Équipes et missions** : création, couleur, responsable, consignes, désactivation ; affectation ordonnée,
  réordonnancement, réaffectation, statuts de mission avec transitions contrôlées (la fin d'une mission ne libère
  pas le point).
- **Fonds de carte** au choix (mémorisé dans le navigateur) : plan OSM vectoriel (par défaut, net à tout zoom),
  plan OSM en images, plan IGN, photo aérienne IGN (France), satellite Esri (monde).
- **Clic sur la carte** : menu avec la position (et la distance sur le parcours), « Voir les photos ici »,
  « Ajouter un point ici », « Copier les coordonnées ». Un clic sur une suggestion ouvre sa bulle (valider,
  écarter, photos, détails).
- **Photos de rue Panoramax** : « Voir les photos ici » (menu de la carte) ou le bouton 📷 d'un point ou d'une
  suggestion ouvre la photo [Panoramax](https://panoramax.fr) la plus proche (à moins de 50 m) dans le viewer
  officiel, pour vérifier un carrefour ou un accès sans se déplacer. Le panneau se déplace par sa barre de titre
  (position mémorisée, double-clic pour le replacer) et peut être agrandi. La couverture photo est tracée en orange
  à partir du zoom 13 (case « Couverture photos »). Une photo peut être ancienne : elle ne reflète pas forcément
  l'état actuel.
- **Roadbook** (onglet Équipes ou Synthèse) : par équipe ou pour toute la manifestation, page imprimable ou
  enregistrable en PDF (« Imprimer / PDF ») : page de garde avec consignes générales et carte d'ensemble, puis par
  équipe le responsable, les consignes, le tableau ordonné des missions et une fiche par lieu : les points à moins
  de 50 m les uns des autres (ex. les accès d'un même carrefour) sont regroupés, avec une grande carte zoomée où
  les numéros des missions sont indiqués, puis pour chaque point coordonnées, distance sur le parcours, description,
  voie d'accès et consignes, et une zone de notes. Le roadbook complet liste aussi les points sans équipe. **Export GPX** des points (dans l'ordre des
  missions) et du parcours, pour un téléphone ou un GPS.
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
| `LOGIN_RATE_LIMIT` | Tentatives de connexion par minute et par adresse IP | `20` |
| `ROUTING_URL` | Serveur d'itinéraires compatible OSRM (profil piéton), facultatif | — (lien vers la carte OSM) |
| `JOIN_RATE_LIMIT` | Ouvertures de lien d'invitation par minute et par adresse IP | `30` |
| `OVERPASS_URL` | Serveurs Overpass, séparés par des virgules, essayés dans l'ordre | `overpass-api.de`, puis `overpass.private.coffee` |
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
  minute et par adresse. L'application interroge un couloir de 40 m autour du parcours, découpé en tronçons envoyés
  l'un après l'autre (une seule grosse requête fait souvent répondre 502 ou 504), réessaie sur les erreurs
  passagères en passant au serveur suivant, refuse les réponses tronquées, considère une réponse sans aucune voie
  comme suspecte (serveur suivant, puis erreur explicite plutôt que « aucune suggestion »), et conserve les
  résultats. L'analyse tourne en tâche de fond (avancement affiché) pour ne pas être coupée par un proxy HTTPS. Pour un usage régulier : instance Overpass auto-hébergée sur un extrait
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

## Ce que fait la phase 2

- **Écran « Comptes »** (administrateurs) : création, rôle global, désactivation, révocation des sessions,
  réinitialisation du mot de passe.
- **Accès des comptes** à une manifestation (onglet Synthèse) : recherche dans l'annuaire, rôle organisateur,
  responsable ou membre.
- **Membres et invitations** par équipe (onglet Équipes) :
  - QR code d'équipe imprimable, admission immédiate ou après validation, nombre maximal de personnes, expiration,
    suspension, régénération (l'ancien QR cesse de fonctionner) ; il ne donne que le rôle de membre ;
  - liens individuels à usage unique (24 h à 30 jours), affichés une seule fois, révocables ; seul un organisateur
    peut inviter un responsable ;
  - demandes à valider, liste des membres, retrait (accès coupé immédiatement), lien de récupération d'accès pour un
    nouveau téléphone (les autres appareils sont déconnectés) ;
  - option « les responsables peuvent inviter et valider des membres ».
- **Participants sans compte** : la page `/rejoindre/<jeton>` demande seulement un pseudonyme ; la session (cookie
  `HttpOnly`) dure jusqu'au lendemain de la manifestation, 30 jours au plus. Le participant ne voit que la page de son
  équipe (consignes, missions) — la vraie vue mobile de mission arrive en phase 3.

## Ce que fait la phase 3 (le jour J)

- **Vue terrain** (téléphone, installable sur l'écran d'accueil) pour chaque membre d'équipe : mission en cours,
  consignes, carte du point et du parcours, grands boutons *En route*, *Arrivé*, *Terminé*, *Relève nécessaire*,
  *Aide* et *Signaler un incident*, point suivant, liste des missions, indicateur « ● direct ». Les participants y
  arrivent directement ; un compte membre d'une équipe l'ouvre depuis l'onglet « Mon équipe ».
- **Statuts depuis le terrain** : un membre ne peut qu'avancer sa mission (revenir en arrière ou réaffecter reste
  une décision de l'organisation) ; qui a changé le statut, et quand, est affiché.
- **Incidents** (aide, sécurité, santé, circulation, matériel…) liés à la mission et, si la personne le choisit, à sa
  position du moment ; suivis par l'organisation ou le responsable d'équipe (*Je m'en occupe*, *Résolu*). Rappel
  affiché : un signalement ne prévient pas les secours (15, 17, 18, 112).
- **Messages** : annonces à toutes les équipes ou à une équipe, éventuellement urgentes (bandeau sur les téléphones),
  réponses du terrain, accusés de lecture (« lu 3/5 »).
- **Progression déclarée** de la tête du cortège (km parcourus) par l'organisation ou un responsable : chaque membre
  voit à quelle distance de son point elle se trouve. Ce n'est jamais une position GPS.
- **Itinéraire à pied** vers le point : par un serveur compatible OSRM si `ROUTING_URL` est configuré (par exemple
  `https://routing.openstreetmap.de/routed-foot`, à utiliser selon ses conditions, ou une instance auto-hébergée),
  sinon lien vers la carte OpenStreetMap. Indicatif : accès et sécurité à vérifier sur place.
- **Onglet « Coordination »** de l'organisation : compteurs, incidents ouverts, état de chaque mission par équipe,
  membres actifs, messages, progression — tout se met à jour **en direct**.
- **Direct** : WebSocket `/api/direct?event=<id>` qui envoie un simple signal « mise à jour » après chaque modification
  validée ; l'écran recharge ce que ses droits lui permettent de voir (le signal ne contient aucune donnée). En cas de
  coupure : reconnexion automatique et rechargement toutes les 30 s.
- **Position** : demandée seulement à la demande (*Ma position*), elle reste sur le téléphone ; elle n'est envoyée que
  pour calculer un itinéraire ou si on la joint à un incident, et n'est jamais suivie en continu.

Derrière un proxy HTTPS, autorisez la mise à niveau WebSocket sur `/api/direct` (nginx : `proxy_http_version 1.1;`
`proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";` — Caddy le fait d'office).

## Sécurité (phases 1 à 3)

- Aucune route d'inscription ; création et rôles des comptes réservés aux administrateurs.
- Mots de passe hachés avec scrypt ; sessions par cookie `HttpOnly`, `SameSite=Lax`, `Secure` en production ;
  seul le hash SHA-256 du jeton est stocké ; révocation à la déconnexion, à la désactivation du compte ou au
  changement de mot de passe.
- Toutes les permissions sont vérifiées côté serveur ; un événement inaccessible répond 404.
- En-tête `X-Requested-With` exigé sur toute requête modifiante (protection CSRF en plus de `SameSite`).
- Limitation des tentatives de connexion (par adresse et par identifiant).
- Verrou optimiste (`version`) sur les événements, points, équipes et missions : pas d'écrasement silencieux.
- Journal d'audit des modifications importantes, sans secret.
- Invitations : seul le hash SHA-256 d'un lien individuel est stocké ; les URL `/rejoindre/*` sont masquées dans les
  journaux et servies avec `Referrer-Policy: no-referrer` ; ouvertures de lien limitées par adresse
  (`JOIN_RATE_LIMIT`, 30 par minute par défaut). Un participant n'a jamais accès à l'organisation de la manifestation.

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
- Le compteur de tentatives de connexion et le direct (abonnés WebSocket) sont en mémoire : une seule instance du
  serveur.
- Pas encore de mode hors ligne : sans réseau, la vue terrain affiche les dernières informations reçues et le moment
  de la dernière synchronisation, mais les actions échouent (file d'actions prévue en phase 4).
