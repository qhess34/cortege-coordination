# Coordination de cortège

Application web de préparation du parcours d'une manifestation sur la voie publique et de coordination des équipes
d'encadrement : import du parcours GPX, analyse du réseau viaire OpenStreetMap, points de mission, équipes et
missions ordonnées, puis coordonne les équipes le jour J depuis une application mobile installable.

![Interface organisateur](docs/apercu-organisateur.png)

*Capture prise dans l'environnement de test, sans accès aux tuiles : en usage réel, le fond de carte OSM s'affiche
sous le tracé.*

> **Avertissement.** Les points proposés à partir d'OpenStreetMap sont des **suggestions à vérifier**. Les données
> OSM peuvent être incomplètes ou obsolètes et ne constituent pas une source officielle sur les arrêtés,
> autorisations, fermetures ou conditions de circulation. L'application ne garantit pas la sécurité d'un parcours,
> n'autorise pas la fermeture d'une voie et ne remplace ni les autorités compétentes, ni les procédures officielles,
> ni les services d'urgence.

**Guides d'utilisation** (aussi affichés dans l'application : lien *Aide* de la barre du haut pour l'organisation,
onglet *?* de la vue terrain pour les membres) :
- [Guide de l'organisation](docs/guide-organisateur.md) — préparer la manifestation, répartir les équipes, coordonner
  le jour J ;
- [Guide des membres d'équipe](docs/guide-membre.md) — activer son compte, sa mission sur téléphone, messages,
  SOS, partage de position.

La conception (architecture, modèle de données, écrans, risques) est décrite dans [docs/CONCEPTION.md](docs/CONCEPTION.md).

## Comptes, connexion et interfaces

- **Comptes administrés**, sans inscription publique : le premier administrateur est créé en ligne de commande, puis
  les administrateurs créent tous les comptes (écran « Comptes ») :
  - **comptes d'organisation** (identifiant et mot de passe) : rôle global, désactivation, révocation des sessions,
    nouveau mot de passe, suppression ;
  - **comptes de membres d'équipe** : prénom, nom, e-mail et téléphone facultatifs, sans identifiant ni mot de passe. Le **lien
    d'activation** obtenu à la création connecte le membre sur son téléphone pour plusieurs jours ; il complète
    ensuite son **profil** (prénom, nom, e-mail, téléphone).
  - **date d'expiration** facultative pour tout compte : passé cette date, il ne peut plus se connecter et est
    **supprimé automatiquement** (vérification toutes les heures, suppression journalisée).
- **Accès par manifestation** (onglet Synthèse) : recherche dans l'annuaire, rôle organisateur, responsable ou membre.
  Chaque compte ne voit que les manifestations auxquelles il a accès ; un administrateur voit tout.
- **Membres des équipes** (onglet Équipes → Membres) : l'organisation ajoute des comptes membres (et des comptes
  d'organisation ayant accès à la manifestation), désigne les responsables, envoie un lien de connexion, retire un
  membre. Les responsables peuvent le faire depuis leur vue terrain si l'organisation le permet. Un **membre ne voit
  que ses équipes** (vue terrain), jamais la planification ni les autres équipes.
- **Téléphone** (facultatif) : cliquable pour l'organisation (liste des membres, *Coordination* → « Joindre
  l'équipe ») et pour les responsables ; le numéro d'un responsable est affiché aux membres de son équipe.
- **Première page** : connexion par identifiant et mot de passe, ou par **lien de connexion** à usage unique :
  - QR code « 📱 Connecter un appareil » affiché par un appareil déjà connecté (10 min) ;
  - lien créé par un administrateur ou un responsable (72 h) ;
  - lien envoyé par e-mail (15 min), si `SMTP_URL` est configuré et que le compte a une adresse e-mail.

  La connexion n'est faite qu'au clic sur *Se connecter* : un logiciel qui pré-ouvre les liens d'un e-mail ne la
  déclenche pas. La désactivation du compte ou un nouveau mot de passe invalident les liens en cours.
- **Application installable** (PWA) : bouton *Installer* quand le navigateur le permet, mode d'emploi pour iPhone.
- **Deux interfaces pour l'organisation** : *🗺 Planifier* (ordinateur : parcours, suggestions, points, équipes) et
  *📱 Coordination en direct* (`#/direct/<id>`, téléphone : direct, SOS, équipes, messages, carte, en onglets).
  Un compte d'organisation membre d'une équipe ouvre aussi sa vue terrain (onglet « Mon équipe »).

## Préparer la manifestation

- **Manifestations** isolées : la barre du haut permet de basculer de l'une à l'autre et d'en créer une ; un
  organisateur peut supprimer définitivement une manifestation depuis sa synthèse (nom à retaper, impossible pendant
  l'événement ; seule une trace de la suppression est conservée dans le journal).
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
  sa bulle (nom, type, description) ; le nom est proposé d'après la rue ou le croisement (« Rue A × Rue B ») ; il n'est créé qu'à la validation, et un nouveau clic le déplace. Un clic sur un
  point existant ouvre la même bulle : renommer, changer le type, enregistrer, annuler ou supprimer. Pour
  **déplacer** un point, faites-le glisser directement : sa bulle s'ouvre avec « position modifiée », puis
  « Enregistrer » (ou « Annuler » pour le remettre en place), avec les conséquences si le point est affecté. Le nom
  affiché sur la carte suit la saisie.
  Le panneau latéral garde la liste, la recherche, les filtres, l'historique et le placement par coordonnées.
- **Équipes sur la carte** : la bulle d'un point permet de l'affecter à une ou plusieurs équipes (ou de l'en
  retirer) ; pour un nouveau point, l'équipe se choisit avant l'ajout. Chaque point prend la couleur de son équipe
  (pastille partagée s'il en a plusieurs, gris sans équipe). Une légende liste les équipes avec leur nombre de points
  et permet de masquer ou d'afficher les points de chacune.
- **Équipes et missions** : création, type (points fixes, volante, ouverture, fermeture), couleur, responsable,
  consignes, désactivation ; affectation ordonnée,
  réordonnancement, réaffectation, statuts de mission avec transitions contrôlées (la fin d'une mission ne libère
  pas le point). Toutes les missions (de la manifestation ou d'une équipe) peuvent être **remises à « Affectée »** en
  une fois, par exemple après une répétition : affectations et ordre conservés.
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
- **Roadbook** (onglet Équipes) : par équipe ou pour toute la manifestation, page imprimable ou
  enregistrable en PDF (« Imprimer / PDF ») : page de garde avec consignes générales et carte d'ensemble, puis par
  équipe le responsable, les consignes, le tableau ordonné des missions et une fiche par lieu : les points à moins
  de 50 m les uns des autres (ex. les accès d'un même carrefour) sont regroupés, avec une grande carte zoomée où
  les numéros des missions sont indiqués, puis pour chaque point coordonnées, distance sur le parcours, description,
  voie d'accès et consignes, et une zone de notes. Le roadbook complet liste aussi les points sans équipe.
  **Export GPX** par équipe (un POI par carrefour, ou par accès sur option, numéroté dans l'ordre des missions, et le
  parcours), téléchargeable aussi par les membres depuis leur vue terrain, ou de tous les points, pour un téléphone
  ou un GPS.
- **Carrefours** : les accès validés d'un même carrefour sont regroupés automatiquement (nommés d'après le
  croisement) ; les autres points proches (moins de 50 m) peuvent être regroupés depuis leur bulle, jamais d'office.
  Chaque accès reste un point de mission ; le carrefour sert au GPX et au suivi (une ligne et un marqueur par
  carrefour, « 1/3 accès tenus », état le plus grave).
- **Synthèse** : points validés sans équipe, répartition des statuts, analyse à relancer après changement de
  parcours.

## Le jour J

- **Vue terrain** (téléphone) pour chaque membre d'équipe : mission en cours, consignes, carte du point et du
  parcours, grands boutons *En route*, *Arrivé*, *Terminé*, *Relève nécessaire* et *🆘 SOS*,
  bouton *🧭 Aller au point suivant* (ouvre l'application GPS du téléphone), points restants avec leur
  distance depuis le point en cours, indicateur « ● direct ». Le point à traiter est en haut de l'écran ; partage de
  position et OwnTracks sont réduits à une ligne en dessous. Les membres y arrivent directement après connexion.
- **Statuts depuis le terrain** : un membre ne peut qu'avancer sa mission (revenir en arrière ou réaffecter reste
  une décision de l'organisation) ; qui a changé le statut, et quand, est affiché.
- **SOS** : un bouton ouvre une fenêtre avec un **type** (liste configurable par l'organisation, p. ex. besoin de
  renforts, besoin de secours, agression…) et un **texte facultatif**, lié à la mission et, si la personne le choisit,
  à sa position du moment ; résolu par l'organisation, le responsable d'équipe ou l'équipe volante (*Résolu*). Rappel
  affiché : un SOS ne prévient pas les secours (15, 17, 18, 112).
- **Messages** : annonces à toutes les équipes ou à une équipe, éventuellement urgentes (bandeau sur les téléphones),
  réponses du terrain, accusés de lecture (« lu 3/5 »).
- **Types d'équipe** :
  - *Points fixes* : tiennent les points de leur liste ;
  - *Volante* : sans point fixe, elle voit les SOS de toute la manifestation ; les SOS en cours sont en tête de son
    écran avec **🧭 Rejoindre le lieu** (application GPS vers la position signalée, sinon le point de l'équipe qui a
    déclenché le SOS), de même que les **relèves nécessaires** (lien GPS vers le point) ; un nouveau SOS fait vibrer
    le téléphone. Elle peut les clore ; sa carte montre tous les points tenus ;
  - *Ouverture* : porte la **tête** du cortège ;
  - *Fermeture* : porte la **queue** ; un point dépassé par la queue est signalé à son équipe (« vous pourrez le
    lever sur instruction ») et apparaît « à lever » dans la coordination.
- **Progression du cortège** (tête et queue, en distance sur le parcours) : chaque membre voit à quelle distance de
  son point se trouve la tête.
  - **Automatique** quand le partage de position est actif : la tête suit le membre de l'ouverture le plus avancé, la
    queue le membre de la fermeture le plus en arrière. Seules les positions récentes (10 min), assez précises
    (≤ 100 m) et à moins de 150 m du parcours comptent ; sur une boucle, le passage le plus proche de la progression
    précédente est retenu. Une mise à jour par minute au plus, et seulement si elle a bougé d'au moins 20 m ; elle
    est enregistrée sans auteur ni coordonnées.
  - **Déclarée** sinon, depuis la vue terrain : par l'ouverture ou les responsables (tête), la fermeture (queue), en
    km parcourus ou « 📍 ici » (position du téléphone ramenée sur le parcours).
    Tout autre membre dont la position est connue a un simple bouton *📍 La tête est ici*.
  - C'est une indication, à confirmer sur le terrain.
- **Onglet « Coordination »** de l'organisation : compteurs (SOS, tête, queue, points à lever), **prochains points devant la tête** et leur état (équipe en position,
  personne, SOS),
  **statut résumé de chaque équipe** avec raccourcis vers son responsable (appel, SMS, message dans l'application),
  SOS ouverts, état de chaque mission par équipe, membres actifs, messages — tout se met à jour
  **en direct**.
- **SOS sur les cartes de l'organisation** (planification et coordination en direct) : 🆘 au lieu signalé ou au point
  concerné ; clignotant tant que le SOS n'est pas résolu.
- **Direct** : WebSocket `/api/direct?event=<id>` qui envoie un simple signal « mise à jour » après chaque modification
  validée ; l'écran recharge ce que ses droits lui permettent de voir (le signal ne contient aucune donnée). En cas de
  coupure : reconnexion automatique et rechargement toutes les 30 s.

## Partage de position (facultatif)

Sans partage, la position du téléphone n'est demandée qu'à l'usage (*📍 ici*, SOS avec position) et n'est
envoyée que pour ces actions.

- **Double accord** : l'organisation l'autorise pour la manifestation (Synthèse → Modifier → *Autoriser le partage de
  position en direct*), puis chaque membre choisit *Partager ma position* sur son téléphone, et peut l'arrêter à tout
  moment. L'organisation voit alors les membres sur sa carte (couleur de l'équipe, nom, heure, précision) et le
  nombre de membres suivis par équipe dans la coordination.
- **Arrivée automatique** : à moins de 30 m de son point (précision GPS ≤ 50 m), la mission en cours passe d'elle-même
  « en position » (enregistré comme fait par le membre, visible dans la coordination).
- **Progression automatique** du cortège par les équipes d'ouverture et de fermeture (voir ci-dessus).
- **Vie privée** : seule la **dernière** position est conservée — aucun historique, rien dans le journal d'audit —,
  visible de l'organisation seulement, masquée après 10 minutes sans mise à jour et supprimée après 2 heures, à
  l'arrêt du partage, au retrait de l'équipe ou quand l'organisation désactive le partage. Pensez à en informer les
  membres (base légale, information RGPD).
- **Limite du navigateur** : une application web ne suit la position que **tant qu'elle est ouverte à l'écran**
  (l'écran est gardé allumé pendant le partage quand le navigateur le permet) ; écran verrouillé ou application en
  arrière-plan, les envois s'arrêtent — surtout sur iPhone. D'où OwnTracks, ci-dessous.

**Suivi écran éteint avec OwnTracks** : l'application libre et gratuite [OwnTracks](https://owntracks.org)
(Android : Google Play ou F-Droid ; iPhone : App Store) envoie la position même téléphone verrouillé.

- Le membre touche *Configurer* dans sa vue terrain, puis *Ouvrir OwnTracks avec la configuration* : l'application se
  règle seule (mode HTTP vers `/api/owntracks`, identifiant de suivi personnel, envoi ≈ 30 s / 20 m). Un QR code
  permet de configurer un autre téléphone. Le lien contient un secret : il n'est affiché qu'une fois et n'est jamais
  journalisé ; seul son hash est stocké.
- Les **points de mission de l'équipe deviennent des zones** dans OwnTracks (rayon réglable par manifestation, 50 m
  par défaut) : y entrer enregistre l'arrivée, même avec une position imprécise. Les zones sont mises à jour
  automatiquement quand les missions changent.
- Mêmes règles que le partage par le navigateur. L'organisation voit dans *Coordination* les téléphones suivis, leur
  dernier envoi et leur **batterie**, et peut révoquer un suivi.
- Fin : identifiant révoqué (par le membre ou l'organisation), partage désactivé ou lendemain de la manifestation ⇒
  le serveur refuse les positions et demande à l'application de se mettre **au repos** ; on peut ensuite la
  désinstaller. Reconfigurer sur un nouveau téléphone révoque l'ancien.
- **Prérequis** : HTTPS (obligatoire sur iPhone) et `PUBLIC_URL`. Le mode suivi d'OwnTracks consomme beaucoup de
  batterie : prévoir des batteries externes et tester avant le jour J ; autoriser la localisation « Toujours » et
  désactiver l'économie de batterie pour l'application.

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
session sont `Secure` par défaut dans ce mode (`COOKIE_SECURE=true`) : sans HTTPS, la connexion échouera. HTTPS est
aussi nécessaire pour la géolocalisation, l'installation sur téléphone et OwnTracks ; renseignez `PUBLIC_URL`.

Derrière un proxy HTTPS, autorisez la mise à niveau WebSocket sur `/api/direct` (nginx : `proxy_http_version 1.1;`
`proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";` — Caddy le fait d'office).

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
exécution. Les tests de bout en bout utilisent `E2E_DATABASE_URL` (par défaut `cortege_e2e`). Aucun test n'appelle
les services OSM : le réseau OSM des tests est construit dans `server/test/helpers/osm.ts`.

## Configuration

| Variable | Rôle | Défaut |
|---|---|---|
| `DATABASE_URL` | Connexion PostgreSQL | — (obligatoire) |
| `PORT`, `HOST` | Écoute du serveur | `3000`, `127.0.0.1` |
| `COOKIE_SECURE` | Cookies réservés à HTTPS | `true` en production |
| `SESSION_TTL_HOURS` | Durée des sessions (glissante) | `12` |
| `LOGIN_RATE_LIMIT` | Tentatives de connexion par minute et par adresse IP | `20` |
| `PUBLIC_URL` | Adresse publique du site (`https://…`), pour la configuration OwnTracks | déduite de la requête |
| `SMTP_URL` | Serveur d'envoi d'e-mails (`smtps://utilisateur:motdepasse@hôte:465`) pour les liens de connexion, facultatif | — |
| `MAIL_FROM` | Expéditeur des e-mails | `Coordination de cortège <no-reply@localhost>` |
| `LINK_RATE_LIMIT` | Ouvertures de liens de connexion par minute et par adresse IP | `30` |
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
  résultats. L'analyse tourne en tâche de fond (avancement affiché) pour ne pas être coupée par un proxy HTTPS. Pour
  un usage régulier : instance Overpass auto-hébergée sur un extrait régional (Geofabrik), puis `OVERPASS_URL`.
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

## Sécurité

- Aucune route d'inscription ; création et rôles des comptes réservés aux administrateurs.
- Mots de passe hachés avec scrypt ; sessions par cookie `HttpOnly`, `SameSite=Lax`, `Secure` en production ;
  seul le hash SHA-256 du jeton est stocké ; révocation à la déconnexion, à la désactivation du compte ou au
  changement de mot de passe.
- Toutes les permissions sont vérifiées côté serveur ; un événement inaccessible répond 404. Un compte membre n'a
  jamais accès à l'organisation d'une manifestation.
- En-tête `X-Requested-With` exigé sur toute requête modifiante (protection CSRF en plus de `SameSite`).
- Limitation des tentatives de connexion (par adresse et par identifiant) et des ouvertures de liens de connexion
  (`LINK_RATE_LIMIT`).
- Liens de connexion et secrets OwnTracks : seul le hash est stocké ; les URL `/connexion/*` sont masquées dans les
  journaux et servies avec `Referrer-Policy: no-referrer`.
- Verrou optimiste (`version`) sur les événements, points, équipes, missions et SOS : pas d’écrasement silencieux.
- Journal d'audit des modifications importantes, sans secret ni position.

## Structure du dépôt

```
server/            API Fastify (TypeScript)
  migrations/      schéma SQL (PostGIS) : 001_initial.sql, puis une migration par évolution future
  src/cli/         création d'administrateur, migrations
  src/geo/         calculs purs : parcours, GPX, analyse OSM, nom des lieux
  src/routes/      routes HTTP, une par domaine
  src/services/    analyses, missions, Overpass, direct, positions, e-mails, expiration des comptes
  test/            tests unitaires et d'intégration
web/               interface React + Vite + MapLibre (application installable)
e2e/               tests de bout en bout Playwright
docs/              conception, guides d'utilisation, capture
```

## Limites connues et pistes

- L'analyse OSM n'a été validée que sur des réseaux synthétiques : à confronter à de vrais parcours (le résultat
  dépend de la qualité du tracé GPX et des données OSM locales). Les seuils (15 m, 35°, 25 m) se règlent dans
  `server/src/geo/osm-analysis.ts`.
- Les grands carrefours à chaussées séparées peuvent produire plusieurs suggestions voisines ; le regroupement se
  fait à 25 m.
- Le compteur de tentatives de connexion, la limite d'envoi d'e-mails et le direct (abonnés WebSocket) sont en
  mémoire : une seule instance du serveur.
- Pas de mode hors ligne : sans réseau, la vue terrain affiche les dernières informations reçues et le moment de la
  dernière synchronisation, mais les actions échouent.
- Pistes : file d'actions hors ligne, relèves avancées, exports, diagnostic.
