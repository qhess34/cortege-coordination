---
name: architecture
description: Carte du code de l'application de coordination de cortège (serveur Fastify/PostGIS, interface React/MapLibre, e2e Playwright) — où se trouve quoi, modèle de données, temps réel, sessions. À lire avant de chercher où modifier quelque chose.
---

# Architecture de l'application

Monorepo npm (workspaces `server` et `web`), textes et commentaires en français. Règles impératives : `AGENTS.md`.
Conception détaillée : `docs/CONCEPTION.md`.

## Serveur (`server/`, Fastify 5, zod 4, pg + PostGIS)

- `src/app.ts` : construction de l'application (cookies, CSRF par en-tête `X-Requested-With: cortege`, routes,
  masquage des URL sensibles `/connexion/*` dans les journaux, hooks du direct).
- `src/auth.ts` (sessions : jeton haché SHA-256 en cookie `HttpOnly`), `src/permissions.ts` (`eventRole`,
  `requireEventRole`, `requireEntityAccess`, `requireTeamManager`).
- `src/routes/` : une route par domaine.
  - `events`, `tracks` (GPX), `suggestions` (analyse OSM, validation → point), `points` (+ carrefours : regrouper,
    séparer), `teams` (missions, statuts, remise à « Affectée »), `roadbook` (roadbook et GPX).
  - `terrain` (jour J : vue d'équipe, incidents, messages, progression, tableau, positions, WebSocket `/api/direct`).
  - `owntracks`, `members` (membres d'équipe, profil), `admin` (comptes), `auth`, `login-links` (liens magiques).
- `src/services/` : `live.ts` (signal du direct), `locations.ts` (positions, arrivée et progression automatiques),
  `places.ts` (carrefours), `merge.ts` (nouvelle analyse non destructive), `missions.ts`, `overpass.ts`,
  `expiry.ts` (purge des comptes expirés), `mailer.ts`.
- `src/geo/` : calculs purs, testés sans base (`route.ts` : projection sur le parcours, `osm-analysis.ts`,
  `place-name.ts`, `gpx.ts`).
- `migrations/NNN_*.sql` : appliquées dans l'ordre au démarrage (`src/migrate.ts`), une seule fois chacune.

## Modèle (essentiel)

- `users` : `global_role` ∈ admin | organisateur | membre | aucun. Un **membre** n'a ni identifiant ni mot de passe
  (connexion par lien), n'a jamais accès à l'organisation (`eventRole` → null), voit seulement ses équipes.
  `expires_at` : suppression automatique. `phone` facultatif.
- `events` → `gpx_tracks` (parcours courant) → `map_suggestions` (OSM, jamais supprimées) ≠ `mission_points`
  (retenus ; `place_id` → `places` = carrefour regroupant ses accès).
- `teams` (`kind` ∈ points | volante | ouverture | fermeture) → `missions` (ordre, statut) ; `team_memberships`
  (membre | responsable).
- Jour J : `incidents`, `messages` + `message_receipts`, `event_progress` (tête/queue), `member_locations`
  (dernière position seulement, jamais dans l'audit), `trackers` (OwnTracks).
- `audit_logs` : toute modification importante (`audit()`), jamais de secret ni de position.

## Temps réel

`audit()` marque la manifestation modifiée ; après la réponse, `app.live.publish(eventId)` envoie `{type:'maj'}` (sans
données) aux WebSocket abonnés. Les positions seules publient `'positions'`. Une modification **sans** `audit()` doit
appeler `app.live.publish` elle-même. Côté client : `web/src/useLive.ts` (reconnexion, rechargement toutes les 30 s).

## Interface (`web/`, React 19, Vite, MapLibre)

- `App.tsx` : routes par hash. Compte membre → vue terrain ; organisation → `#/evenements/:id` (planification),
  `#/direct/:id` (coordination mobile), `#/admin`, `#/aide`, `#/profil`.
- `pages/EventPage.tsx` + `pages/event/*Panel.tsx` (onglets de planification) ; `pages/LiveCoordPage.tsx` (mobile,
  onglets) ; `pages/event/CoordinationPanel.tsx` (sections partagées par les deux, `placeGroups` pour le suivi par
  carrefour).
- `components/FieldView.tsx` (vue terrain des équipes), `MapView.tsx` (carte de planification), `LiveMap.tsx`,
  `FieldMap.tsx`, `PointEditor.tsx` (bulle d'un point), `incidentMarkers.ts`, `TeamAccess.tsx`.
- `types.ts`, `labels.ts` (libellés et formats), `api.ts` (en-tête CSRF, erreurs `ApiError`).
- Guides affichés dans l'application : `docs/guide-*.md` importés en `?raw` (d'où leur copie dans le Dockerfile).
