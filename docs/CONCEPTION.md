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
            │  • PWA terrain (mobile)        [phase 3]     │
            │  MapLibre GL JS, GeoJSON                     │
            └───────────────┬─────────────────────────────┘
                REST JSON   │  WebSocket [phase 3]   cookie de session HttpOnly
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
                                  │ [phase 3]                     │
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
| Temps réel | WebSocket (`@fastify/websocket`) [phase 3] | Bidirectionnel, simple derrière un proxy | SSE (unidirectionnel), Socket.IO (protocole propriétaire) |
| Sessions | Jeton aléatoire en cookie `HttpOnly; Secure; SameSite=Lax`, seul le **hash** SHA-256 est stocké | Jeton inaccessible au JavaScript, révocable côté serveur | JWT (révocation difficile) |
| Mots de passe (administrateurs, organisateurs) | `scrypt` de Node (`crypto`) | Aucune dépendance native à compiler | argon2 (module natif) |
| Tests | Vitest (unitaires + intégration sur vraie base PostGIS), Playwright (bout en bout) | Rapides, TypeScript natif | Jest |
| Déploiement | Docker Compose (PostGIS + application) | Auto-hébergement simple | Kubernetes (disproportionné) |

### Dépendance aux services publics OSM

| Service | Usage | Limites | Pour un usage plus important |
|---|---|---|---|
| Overpass API (`overpass-api.de`) | Une requête par analyse, limitée à un couloir autour du parcours | Quelques requêtes par minute et par IP, temps de réponse variable, pas de SLA | Instance Overpass auto-hébergée sur un extrait Geofabrik régional ; URL configurable `OVERPASS_URL` |
| Tuiles `tile.openstreetmap.org` | Fond de carte | [Politique d'usage](https://operations.osmfoundation.org/policies/tiles/) : usage modéré, en-tête identifiant, pas de pré-chargement massif | Fournisseur commercial, ou tuiles vectorielles auto-hébergées (Protomaps/PMTiles, OpenMapTiles) ; URL configurable `VITE_TILE_URL` |
| Routage piéton [phase 3] | Itinéraire vers le prochain point | Serveurs de démonstration OSRM/Valhalla non destinés à la production | OSRM ou Valhalla auto-hébergés (profil piéton) |

Les données OSM sont sous licence **ODbL** : l'attribution « © contributeurs OpenStreetMap » est affichée en permanence
sur la carte, et sur toute fiche de mission exportée. Chaque analyse conserve la date des données
(`osm3s.timestamp_osm_base`) pour savoir de quand datent les informations utilisées.

## 2. Modèle de données

Les suggestions automatiques (`map_suggestions`) et les points opérationnels (`mission_points`) sont **deux tables
distinctes**. Valider une suggestion crée un point opérationnel qui la référence ; écarter une suggestion la marque
`ecartee` sans jamais la supprimer, ce qui empêche sa réapparition.

| Table | Rôle | Points clés |
|---|---|---|
| `users` | Comptes administrés (admin, organisateurs, responsables nommés) | `global_role` ∈ `admin`, `organisateur`, `aucun` ; `disabled_at` ; pas d'inscription publique |
| `participants` [phase 2] | Personnes admises par invitation, sans mot de passe | Pseudonyme, rattachées à un événement |
| `events` | Événements | Statut ∈ `preparation`, `pret`, `en_cours`, `termine`, `archive` ; `current_track_id` ; consignes |
| `event_memberships` | Accès d'un compte à un événement | Rôle ∈ `organisateur`, `responsable`, `membre` ; unique (event, user) |
| `teams` | Équipes | Couleur, responsable, statut, `disabled_at` (désactivation, jamais suppression implicite) |
| `team_memberships` [phase 2] | Appartenance à une équipe | Un membre est un compte ou un participant |
| `gpx_tracks` | Versions du parcours | Géométrie `LineString`/`MultiLineString` 4326, longueur, avertissements, `version` croissante |
| `route_points` | Points de passage GPX (`wpt`) | Distance cumulée projetée |
| `osm_analyses` | Historique des analyses | Paramètres, date des données OSM, rapport de comparaison |
| `map_suggestions` | Suggestions OSM | `stable_key` unique par événement ; statut ∈ `a_examiner`, `validee`, `ecartee` ; motif, attributs, incertitudes ; `last_seen_analysis_id` |
| `mission_points` | Points opérationnels | Origine ∈ `suggestion`, `manuel`, `import` ; `distance_m` ; `deleted_at` (suppression logique tant que l'historique en dépend) |
| `missions` | Affectation point ↔ équipe, ordonnée | `position` ; statut ∈ `a_preparer`, `affectee`, `en_deplacement`, `en_position`, `terminee`, `releve_necessaire`, `incident` ; `version` (verrou optimiste) |
| `invitations` [phase 2] | QR code d'équipe ou magic link | Seul le **hash** du jeton est stocké ; type, mode d'admission, expiration, utilisations max, révocation |
| `admission_requests` [phase 2] | Demandes en attente de validation | |
| `sessions` | Sessions (comptes et participants) | Hash du jeton, expiration, `revoked_at`, dernière activité |
| `messages`, `message_receipts` [phase 3] | Communication ciblée, accusés de réception | |
| `incidents` [phase 3] | Incidents | Catégorie, priorité, statut, responsable du suivi, position facultative |
| `event_progress` [phase 3] | Progression **déclarée** du cortège | Distance cumulée, auteur, horodatage ; jamais confondue avec une position GPS |
| `location_updates` [phase 4] | Dernière position partagée volontairement | Une ligne par participant, purge à la fin de l'événement |
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
9. *Administration* [phase 2] — comptes, rôles, sessions.

**Participant (PWA mobile)** [phase 3]
1. *Invitation* — événement, équipe, pseudonyme, bouton *Rejoindre*, messages d'erreur explicites.
2. *Ma mission* — carte du point, consignes, statut, grands boutons *En route*, *Arrivé*, *Terminé*, *Incident*,
   *Aide* ; prochain point ; responsable ; derniers messages ; indicateur de synchronisation.
3. *Itinéraire* — tracé piéton avec avertissement sur ses limites.
4. *Messages* et *Incidents*.

## 5. Authentification et invitations

**Comptes administrés.** Aucun point d'entrée d'inscription. Le premier administrateur est créé en ligne de commande
(`npm run admin:create`). Seuls les administrateurs créent, modifient, désactivent des comptes et attribuent les rôles
globaux. Toute route vérifie côté serveur : session valide → compte actif → droit sur l'événement → droit sur l'action.

**Sessions.** Jeton de 32 octets aléatoires (`crypto.randomBytes`) envoyé en cookie `HttpOnly`, `Secure` en
production, `SameSite=Lax`, `Path=/`. Seul `sha256(jeton)` est stocké. Expiration glissante (12 h pour les comptes,
durée de l'événement + marge pour les participants), révocation individuelle ou globale. Les requêtes modifiantes
exigent un en-tête `X-Requested-With` (protection CSRF complémentaire à `SameSite`). Limitation des tentatives de
connexion par IP et par identifiant.

**QR code d'équipe** [phase 2]. Le QR encode `https://<hôte>/rejoindre/<jeton>` où le jeton est un identifiant
d'invitation aléatoire (pas un mot de passe, pas une session). Paramètres : mode d'admission (`immediate` ou
`validation`), expiration, nombre d'utilisations, suspension. Le droit obtenu est toujours `membre`. Régénérer = révoquer
l'ancien jeton et en créer un nouveau.

**Magic link individuel** [phase 2]. Même forme d'URL, invitation `individuelle` à usage unique, durée configurable,
révocable, éventuellement pré-remplie d'un rôle (`membre` ou `responsable`) choisi par une personne habilitée. Le
jeton est retiré de l'URL par le client dès l'ouverture (`history.replaceState`) et les journaux du serveur masquent
le chemin `/rejoindre/*` et `/api/invitations/*/accept`.

```
Participant           Serveur                                  Base
   │ GET /rejoindre/<jeton>                                     │
   │──────────────────────▶ hash(jeton) → invitation ? ────────▶│
   │◀── événement, équipe, état (valide / expirée / révoquée /  │
   │    consommée / équipe fermée)                              │
   │ POST accept {pseudonyme}                                   │
   │──────────────────────▶ transaction : verrou invitation,    │
   │                        contrôle état, compteur++,          │
   │                        participant + appartenance (ou      │
   │                        demande en attente), session ──────▶│
   │◀── Set-Cookie: session=<jeton> (HttpOnly)                  │
   │ ouvertures suivantes : cookie seul, le lien n'est plus     │
   │ nécessaire                                                  │
```

**Récupération d'accès** sans compte classique : un responsable habilité génère un nouveau magic link individuel
pour le participant existant (rattaché au même participant, l'ancienne session est révoquée).

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
8. Équipes et missions : création, désactivation, affectation, ordre, réaffectation. ✔ (les membres d'équipe
   arrivent avec les invitations, en phase 2)
9. Interface organisateur : carte MapLibre et panneaux. ✔
10. Documentation et test de bout en bout du parcours MVP organisateur. ✔

**Phase 2** — administration des comptes, rôles par événement, participants, invitations QR et magic link, admission
immédiate ou validée, sessions participants, révocation.

**Phase 3** — PWA, vue de mission, transitions de mission par les membres, routage piéton, WebSocket, tableau de bord
partagé, messages, incidents, progression déclarée du cortège.

**Phase 4** — partage GPS facultatif, mode hors ligne avec file d'actions et résolution de conflits, relèves avancées,
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
| Données personnelles (pseudonymes, positions) | Exposition sensible | Minimisation, pas d'e-mail obligatoire, positions non historisées, purge après l'événement |
| Concurrence d'édition entre organisateurs | Écrasement de modifications | Champ `version` et verrou optimiste (`409 Conflict`) |
