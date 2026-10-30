# Dossier de conception

Application de préparation du parcours d'une manifestation sur la voie publique et de coordination des équipes
d'encadrement. Ce document fixe l'architecture, le modèle de données, les écrans, les flux d'accès, le plan de
développement et les risques. Les décisions marquées **[à valider]** méritent une confirmation avant d'être figées.

> L'application **assiste** la préparation et la coordination. Les points proposés à partir d'OpenStreetMap sont des
> suggestions à vérifier. Ils ne garantissent rien en matière de sécurité, ne valent pas autorisation de fermer une
> voie et ne remplacent ni les arrêtés, ni les décisions des autorités compétentes, ni les services d'urgence.

## 1. Architecture technique

```
            ┌──────────────── navigateur ─────────────────┐
            │ web/ : React + TypeScript + Vite             │
            │  • interface organisateur (bureau)           │
            │  • PWA terrain (mobile)                      │
            │  MapLibre GL JS, GeoJSON                     │
            └───────────────┬─────────────────────────────┘
                REST JSON   │  WebSocket   cookie de session HttpOnly
            ┌───────────────┴─────────────────────────────┐
            │ server/ : Node.js 22 + TypeScript + Fastify  │
            │  routes → services → dépôts SQL              │
            │  zod (validation), permissions côté serveur  │
            │  geo/ : GPX, distances, analyse OSM (pur)    │
            └──────┬───────────────────────┬──────────────┘
                   │ SQL                   │ HTTPS (configurable)
            ┌──────┴──────────┐   ┌────────┴──────────────────────┐
            │ PostgreSQL 16 + │   │ Overpass API (données OSM)    │
            │ PostGIS 3       │   │ tuiles raster/vecteur         │
            └─────────────────┘   │ routage piéton (OSRM/Valhalla)│
                                  │                               │
                                  └───────────────────────────────┘
```

### Choix et justifications

| Domaine | Choix | Pourquoi | Alternatives écartées |
|---|---|---|---|
| Langage | TypeScript partout | Un seul langage, types partagés entre client et serveur | Python/Django (deux langages, typage plus faible côté client) |
| Serveur HTTP | Fastify 5 | Rapide, validation et plugins (cookies, multipart, rate-limit, websocket) maintenus | Express (moins structuré), NestJS (lourd pour l'équipe visée) |
| Validation | zod | Schémas lisibles, réutilisables, erreurs précises | JSON Schema écrit à la main |
| Accès BDD | `pg` + SQL explicite | Les requêtes PostGIS s'écrivent mieux en SQL qu'à travers un ORM ; transactions maîtrisées | Prisma (PostGIS mal supporté), TypeORM |
| Migrations | Fichiers SQL numérotés + petit exécuteur | Versionnées, relisibles, sans dépendance | node-pg-migrate (possible plus tard) |
| Base | PostgreSQL + PostGIS | Géométries, index GIST, `ST_DWithin`, intégrité référentielle | SQLite/SpatiaLite (concurrence, temps réel) |
| Calcul géographique | Module pur `server/src/geo` (haversine, projection sur polyligne) | Testable sans base, réutilisable côté client | turf (dépendance lourde pour 5 fonctions) |
| GPX | `@tmcw/togeojson` + `@xmldom/xmldom` | Bibliothèque maintenue, sortie GeoJSON directe | parseur maison |
| Carte | MapLibre GL JS | Libre, rendu vectoriel ou raster, aucun compte requis | Leaflet (pas de vectoriel natif), Mapbox (licence) |
| Temps réel | WebSocket (`@fastify/websocket`) | Bidirectionnel, simple derrière un proxy | SSE (unidirectionnel), Socket.IO (protocole propriétaire) |
| Sessions | Jeton aléatoire en cookie `HttpOnly; Secure; SameSite=Lax`, seul le **hash** SHA-256 est stocké | Jeton inaccessible au JavaScript, révocable côté serveur | JWT (révocation difficile) |
| Mots de passe (administrateurs, organisateurs) | `scrypt` de Node (`crypto`) | Aucune dépendance native à compiler | argon2 (module natif) |
| Tests | Vitest (unitaires + intégration sur vraie base PostGIS), Playwright (bout en bout) | Rapides, TypeScript natif | Jest |
| Déploiement | Docker Compose (PostGIS + application) | Auto-hébergement simple | Kubernetes (disproportionné) |

### Dépendance aux services publics OSM

| Service | Usage | Limites | Pour un usage plus important |
|---|---|---|---|
| Overpass API (`overpass-api.de`) | Une requête par analyse, limitée à un couloir autour du parcours | Quelques requêtes par minute et par IP, temps de réponse variable, pas de SLA | Instance Overpass auto-hébergée sur un extrait Geofabrik régional ; URL configurable `OVERPASS_URL` |
| Tuiles `tile.openstreetmap.org` | Fond de carte | [Politique d'usage](https://operations.osmfoundation.org/policies/tiles/) : usage modéré, en-tête identifiant, pas de pré-chargement massif | Fournisseur commercial, ou tuiles vectorielles auto-hébergées (Protomaps/PMTiles, OpenMapTiles) ; URL configurable `VITE_TILE_URL` |
| Routage piéton | Itinéraire vers le prochain point | Serveurs de démonstration OSRM/Valhalla non destinés à la production | OSRM ou Valhalla auto-hébergés (profil piéton) |

Les données OSM sont sous licence **ODbL** : l'attribution « © contributeurs OpenStreetMap » est affichée en permanence
sur la carte, et sur toute fiche de mission exportée. Chaque analyse conserve la date des données
(`osm3s.timestamp_osm_base`) pour savoir de quand datent les informations utilisées.

## 2. Modèle de données

Les suggestions automatiques (`map_suggestions`) et les points opérationnels (`mission_points`) sont **deux tables
distinctes**. Valider une suggestion crée un point opérationnel qui la référence ; écarter une suggestion la marque
`ecartee` sans jamais la supprimer, ce qui empêche sa réapparition.

| Table | Rôle | Points clés |
|---|---|---|
| `users` | Comptes créés par un administrateur | `global_role` ∈ `admin`, `organisateur`, `membre`, `aucun` ; un `membre` n'a ni identifiant ni mot de passe (connexion par lien) ; prénom, nom, e-mail ; `expires_at` (suppression automatique) ; `disabled_at` ; pas d'inscription publique |
| `events` | Événements | Statut ∈ `preparation`, `pret`, `en_cours`, `termine`, `archive` ; `current_track_id` ; consignes |
| `event_memberships` | Accès d'un compte à un événement | Rôle ∈ `organisateur`, `responsable`, `membre` ; unique (event, user) |
| `teams` | Équipes | Couleur, type ∈ `points`, `volante`, `ouverture`, `fermeture` ; responsable ; `leader_can_manage` ; `disabled_at` (désactivation, jamais suppression implicite) |
| `team_memberships` | Appartenance à une équipe | Compte « membre » ou compte d'organisation ayant accès à la manifestation ; rôle ∈ `membre`, `responsable` |
| `gpx_tracks` | Versions du parcours | Géométrie `LineString`/`MultiLineString` 4326, longueur, avertissements, `version` croissante |
| `route_points` | Points de passage GPX (`wpt`) | Distance cumulée projetée |
| `osm_analyses` | Historique des analyses | Paramètres, date des données OSM, rapport de comparaison, rues nommées relevées (nom des points) |
| `map_suggestions` | Suggestions OSM | `stable_key` unique par événement ; statut ∈ `a_examiner`, `validee`, `ecartee` ; motif, attributs, incertitudes ; `last_seen_analysis_id` |
| `mission_points` | Points opérationnels | Origine ∈ `suggestion`, `manuel`, `import` ; `distance_m` ; `deleted_at` (suppression logique tant que l'historique en dépend) |
| `missions` | Affectation point ↔ équipe, ordonnée | `position` ; statut ∈ `a_preparer`, `affectee`, `en_deplacement`, `en_position`, `terminee`, `releve_necessaire`, `incident` ; `version` (verrou optimiste) |
| `sessions` | Sessions | Hash du jeton, expiration (glissante ; plusieurs jours pour un membre), `revoked_at`, dernière activité |
| `login_links` | Liens de connexion à usage unique | Seul le **hash** du jeton est stocké ; origine ∈ `appareil`, `admin`, `email`, `equipe` ; expiration ; `used_at` |
| `messages`, `message_receipts` | Communication ciblée, accusés de réception | Fil d'équipe ou annonce à tous ; urgent |
| `incidents` | Incidents | Catégorie, priorité, statut, responsable du suivi, position facultative, verrou optimiste |
| `event_progress` | Progression du cortège | Tête ou queue, distance cumulée, horodatage ; déclarée (auteur) ou calculée à partir des positions partagées de l'ouverture et de la fermeture (sans auteur ni coordonnées) |
| `member_locations` | Dernière position partagée volontairement | Une ligne par membre, sans historique ; source (navigateur, OwnTracks), batterie ; purge après 2 h |
| `trackers` | Identifiants de suivi OwnTracks | Hash du secret, expiration, révocation, version des zones envoyées |
| `audit_logs` | Journal des modifications importantes | Acteur, action, entité, avant/après (sans secret) |

**Statut opérationnel d'un point.** Il n'est pas stocké mais **calculé** à partir des missions (`valide` →
`affecte` → `mission_en_cours` → `mission_terminee`), ce qui le garde cohérent avec l'état réel des missions. La fin
d'une mission ne libère pas le point : il reste affecté jusqu'à une décision explicite.

**Suppressions.** Les événements, équipes et points ne sont jamais supprimés en cascade s'ils ont un historique :
un point lié à une mission passe en suppression logique après confirmation, ses missions sont annulées et tracées.
Les clés étrangères utilisent `ON DELETE RESTRICT` par défaut.

**Index.** GIST sur les géométries (`gpx_tracks.geom`, `map_suggestions.geom`, `mission_points.geom`), index sur
`(event_id, status)`, unicité `(event_id, stable_key)` et `(team_id, position)` différable.

Le schéma exact est dans `server/migrations/`.

## 3. Analyse du réseau OSM

1. **Couloir.** Requête Overpass sur les voies `highway=*` à moins de 40 m du parcours (simplifié), avec les nœuds
   (identifiants) et les relations `type=restriction`. La date des données est conservée.
2. **Voies du parcours.** Une voie est considérée « portée par le parcours » si la majorité de ses segments proches
   sont à moins de 12 m du tracé et orientés comme lui. Les autres voies du couloir sont « latérales ».
3. **Connexion réelle = nœud partagé.** Un point n'est proposé que lorsqu'une voie latérale **partage un nœud OSM**
   avec une voie du parcours, près du tracé. Deux voies qui se croisent géométriquement sans nœud commun ne sont pas
   connectées : si l'une est un pont, un tunnel ou sur une autre couche (`bridge`, `tunnel`, `layer`, `covered`),
   le croisement est simplement noté dans le rapport ; sinon il est proposé en **vérification manuelle** (données
   probablement incohérentes).
4. **Classement** de chaque connexion :
   - `carrefour` : la voie latérale traverse le parcours, ou plusieurs voies latérales s'y rejoignent ;
   - `rue_laterale` : une voie aboutit au parcours ;
   - `acces_vehicule_entrant` : une voie ouverte aux véhicules peut **amener** de la circulation sur le parcours ;
   - `acces_pieton_cycle` : voie piétonne, cyclable, escaliers ;
   - `voie_privee` : `access=private` ou équivalent ;
   - `verification` : données manquantes, contradictoires ou croisement sans nœud.
5. **Sens de circulation.** `oneway=yes|1|true|-1|reverse`, `junction=roundabout|circular` (sens unique implicite),
   `oneway:motor_vehicle`. On en déduit si la voie latérale **entre**, **sort** ou est **à double sens** au point de
   connexion. Une voie seulement sortante reste proposée : le sens unique explique la circulation possible, il ne
   rend pas le point sûr.
6. **Accès.** `access`, `vehicle`, `motor_vehicle`, `motorcar`, `hgv`, `bus`, `psv`, `bicycle`, `foot`, et toutes
   les clés `*:conditional` (restrictions temporelles, affichées telles quelles et marquées incertaines).
7. **Restrictions de tournant.** Les relations `restriction` dont le `via` est le nœud de connexion sont jointes à la
   suggestion.
8. **Incertitudes** listées explicitement : `highway` imprécis (`road`, `unclassified` sans nom), accès conditionnel, `fixme`, voie en construction, croisement sans nœud, point à
   plusieurs passages du parcours (boucles).
8 bis. **Un point par accès entrant** (par défaut). Chaque voie qui rejoint le parcours donne un accès par côté (deux
   pour une voie traversante). Pour chaque accès d'où l'on peut arriver (double sens, ou sens unique vers le
   parcours), un point est proposé à 20 m dans la voie, avec son côté (nord, sud-est…). Clé stable :
   `osm:n<nœud du carrefour>-n<nœud voisin dans la voie>`. Option : un point par carrefour.
9. **Identifiant stable.** `stable_key = "osm:n<id nœud>"` pour une connexion ; `"osm:x<id voie A>-<id voie B>"`
   (ordonnés) pour un croisement sans nœud. Lors d'une nouvelle analyse, une suggestion est reconnue par sa clé, ou à
   défaut par une voie latérale commune à moins de 15 m (nœud renuméroté dans OSM). Les suggestions écartées gardent
   leur clé et ne réapparaissent pas.

**Nouvelle analyse, non destructive.** Elle ne fait qu'ajouter : nouvelles suggestions en `a_examiner`, suggestions
déjà connues signalées sans changement de statut, suggestions écartées ignorées, suggestions absentes de la nouvelle
analyse signalées (jamais supprimées). Le rapport présente ces groupes séparément.

## 4. Écrans principaux

**Organisateur (bureau)**
1. *Connexion* — identifiant et mot de passe (comptes créés par un administrateur).
2. *Liste des événements* — ceux auxquels le compte a accès, statut, date.
3. *Événement — synthèse* — nombre de points par statut, équipes, points validés sans équipe, avertissements GPX.
4. *Événement — carte* — carte plein écran à gauche, panneau à droite avec onglets **Suggestions**, **Points**,
   **Équipes**, **Parcours**. Tracé avec flèches de sens, repères kilométriques, points colorés par statut ou équipe.
   Clic sur la carte en mode « ajout » pour créer des points successifs ; points déplaçables à la souris.
5. *Fiche d'une suggestion* — motif, voies concernées, attributs OSM, incertitudes, lien vers l'objet OSM, boutons
   *Valider* / *Écarter*.
6. *Fiche d'un point* — nom, description, type, coordonnées, distance cumulée, historique, missions liées.
7. *Équipe* — informations, membres, missions ordonnées (monter / descendre / réaffecter).
8. *Remplacement du GPX* — aperçu des points qui s'éloigneraient du nouveau tracé, confirmation.
9. *Administration* — comptes (organisation et membres), rôles, expiration, sessions, liens de connexion.
10. *Coordination en direct* (téléphone) — direct, incidents, équipes, messages, carte.

**Membre d'équipe (PWA mobile)**
1. *Connexion par lien* — lien d'activation ou de connexion, confirmation *Se connecter* ; *Mes équipes* ; *Profil*.
2. *Ma mission* — carte du point, consignes, statut, grands boutons *En route*, *Arrivé*, *Terminé*, *Incident*,
   *Aide* ; prochain point ; responsable ; derniers messages ; indicateur de synchronisation.
3. *Itinéraire* — tracé piéton avec avertissement sur ses limites.
4. *Messages* et *Incidents*.

## 5. Comptes et authentification

**Comptes administrés.** Aucun point d'entrée d'inscription. Le premier administrateur est créé en ligne de commande
(`npm run admin:create`). Seuls les administrateurs créent, modifient, désactivent, suppriment des comptes et
attribuent les rôles globaux. Un compte `membre` (membre d'équipe) n'a ni identifiant ni mot de passe : il se connecte
par lien et n'accède qu'à ses équipes (vue terrain), jamais à l'organisation d'une manifestation. Une date d'expiration
facultative entraîne la suppression automatique du compte (vérification horaire, journalisée). Toute route vérifie côté serveur : session valide → compte actif → droit sur l'événement → droit sur l'action.

**Sessions.** Jeton de 32 octets aléatoires (`crypto.randomBytes`) envoyé en cookie `HttpOnly`, `Secure` en
production, `SameSite=Lax`, `Path=/`. Seul `sha256(jeton)` est stocké. Expiration glissante (12 h pour les comptes
d'organisation ; 30 jours au plus pour un membre, sans dépasser l'expiration de son compte), révocation individuelle
ou globale. Les requêtes modifiantes
exigent un en-tête `X-Requested-With` (protection CSRF complémentaire à `SameSite`). Limitation des tentatives de
connexion par IP et par identifiant.

**Liens de connexion.** Jeton aléatoire de 32 octets dans une URL `https://<hôte>/connexion/<jeton>`, à usage unique,
dont seul le hash est stocké. Origines : QR code « Connecter un appareil » affiché par un appareil connecté (10 min),
lien créé par un administrateur — dont le lien d'activation d'un nouveau membre — ou par l'organisation d'une équipe
pour l'un de ses membres (72 h), lien envoyé par e-mail si un serveur SMTP est configuré (15 min, réponse identique
que l'adresse existe ou non). La page n'ouvre la session qu'au clic sur *Se connecter* (un logiciel qui pré-ouvre les
liens d'un e-mail ne la consomme pas), puis recharge l'accueil : le jeton quitte l'adresse et l'historique. Les
journaux masquent `/connexion/*` ; ces pages sont servies sans Referer et jamais mises en cache par le service worker.
Désactiver un compte ou changer son mot de passe invalide ses liens en cours.

```
Téléphone              Serveur                                  Base
   │ GET /api/auth/lien/<jeton>                                 │
   │──────────────────────▶ hash(jeton) → lien ? ──────────────▶│
   │◀── nom du compte, état (valide / utilisé / expiré /        │
   │    compte désactivé ou expiré)                             │
   │ POST /api/auth/lien/<jeton> (clic « Se connecter »)        │
   │──────────────────────▶ transaction : verrou du lien,       │
   │                        contrôle état, used_at, session ───▶│
   │◀── Set-Cookie: session=<jeton> (HttpOnly)                  │
   │ ouvertures suivantes : cookie seul                         │
```

**Membres des équipes.** L'organisation (ou un responsable, si elle le permet) ajoute des comptes à une équipe :
comptes `membre`, ou comptes d'organisation ayant accès à la manifestation. Retirer un membre coupe aussitôt son accès
aux missions de l'équipe et efface sa position partagée.

## 6. Plan de développement

**Phase 1 — prototype cartographique** (terminée ; ✔ = implémenté et testé)
1. Socle : monorepo npm (`server`, `web`), Docker Compose PostGIS, migrations, configuration par variables
   d'environnement. ✔
2. Connexion des comptes administrés (minimale, pour ne jamais exposer l'API sans authentification). ✔
3. Événements : création, modification, synthèse, isolation par appartenance. ✔
4. GPX : validation, géométrie, longueur, distances cumulées, boucles, segments disjoints, points de passage,
   remplacement avec aperçu d'impact. ✔
5. Analyse OSM : client Overpass, algorithme pur testé sur jeux de données, enregistrement non destructif. ✔
6. Suggestions : liste, filtres, validation, exclusion. ✔
7. Points : ajout (clic, coordonnées), déplacement, modification, suppression avec conséquences, historique. ✔
8. Équipes et missions : création, désactivation, affectation, ordre, réaffectation. ✔
9. Interface organisateur : carte MapLibre et panneaux. ✔
10. Documentation et test de bout en bout du parcours MVP organisateur. ✔

**Phase 2** ✔ — administration des comptes (organisation et membres d'équipe), rôles par événement, connexion par lien,
expiration et suppression automatique des comptes, profil, membres des équipes, révocation.

**Phase 3** ✔ — PWA, vue de mission, transitions de mission par les membres, routage piéton, WebSocket, tableau de bord
partagé, messages, incidents, progression du cortège (automatique ou déclarée). Le temps réel est un simple signal d'invalidation (aucune donnée dans le
WebSocket) émis après validation de la transaction, à partir des écritures du journal d'audit ; le routage piéton passe
par un serveur compatible OSRM configurable, avec repli sur un lien vers la carte OpenStreetMap.

**Phase 4** — partage GPS facultatif (✔ avancé : dernière position seulement, double accord, arrivée automatique ; suivi écran éteint par l'application OwnTracks en mode HTTP, points de mission envoyés comme zones), mode hors ligne avec file d'actions et résolution de conflits, relèves avancées,
export des fiches de mission, outils de diagnostic.

## 7. Principaux risques techniques

| Risque | Conséquence | Atténuation |
|---|---|---|
| Données OSM incomplètes ou obsolètes | Accès oubliés ou suggestions inutiles | Afficher incertitudes et date des données ; ajout manuel libre ; message permanent « à vérifier sur le terrain » |
| Faux croisements (ponts, tunnels, mauvais nœuds) | Points erronés | Connexion uniquement par nœud partagé ; croisements sans nœud signalés à part |
| Tracé GPX imprécis (décalé de la voie, enregistré au GPS) | Voies du parcours mal reconnues | Tolérance configurable ; carrefours restent détectés car ils sont près du tracé ; vérification manuelle |
| Disponibilité d'Overpass / des tuiles | Analyse impossible le jour J | Analyse en amont, résultats stockés ; URL configurables ; auto-hébergement documenté |
| Réseau mobile saturé pendant la manifestation | Coordination dégradée | Phase 4 : cache PWA, file locale, horodatage visible, données anciennes signalées |
| Fuite d'un QR code public | Personnes non souhaitées dans une équipe | Rôle membre seulement, admission avec validation, plafond d'utilisations, suspension, retrait immédiat |
| Vol de session | Accès usurpé | Cookie HttpOnly/Secure, hash en base, révocation, durée limitée, rotation à l'admission |
| Données personnelles (noms, e-mails, positions) | Exposition sensible | Minimisation, pas d'e-mail obligatoire, positions non historisées, purge après l'événement |
| Concurrence d'édition entre organisateurs | Écrasement de modifications | Champ `version` et verrou optimiste (`409 Conflict`) |
