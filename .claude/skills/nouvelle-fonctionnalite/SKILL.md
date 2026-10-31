---
name: nouvelle-fonctionnalite
description: Démarche et conventions pour ajouter ou modifier une fonctionnalité de bout en bout (migration, route serveur sécurisée, temps réel, interface, tests, documentation) dans l'application de coordination de cortège.
---

# Ajouter une fonctionnalité

## 1. Base de données

- **Ne jamais modifier une migration déjà appliquée** (`server/migrations/001_initial.sql`…) : elles ne sont jouées
  qu'une fois. Ajouter un fichier `NNN_sujet.sql` (numéro suivant). Une colonne ajoutée dans une ancienne migration
  provoque des erreurs 500 sur les bases existantes.
- Prévoir la reprise des données existantes dans la même migration si besoin (ex. rattacher les lignes existantes à
  une nouvelle table).
- Contraintes `CHECK` explicites, géométries `geometry(Point, 4326)`, `[lon, lat]`.

## 2. Route serveur (`server/src/routes/<domaine>.ts`)

- Corps validé par **zod** (`z.object(...).parse(req.body)`), messages d'erreur en français.
- **Permission d'abord** : `requireEventRole(c, u, eventId, 'lecture' | 'organisation')`, `requireEntityAccess`,
  `requireTeamMember` / `requireTeamManager`. Une ressource inaccessible répond **404** (on ne révèle pas son
  existence) ; un droit insuffisant 403.
- Écritures dans `tx(app.db, async (c) => …)`. Pour une création : `reply.status(201); return valeur;` — jamais
  `reply.send` dans la transaction (la réponse partirait avant la validation).
- Verrou optimiste : `version` dans le corps, `conflict(...)` si elle a changé.
- `audit(c, {...})` pour toute modification importante : déclenche aussi le signal du direct. Sans audit (positions),
  appeler `app.live.publish(eventId[, 'positions'])` après la transaction.
- Jamais de secret, de jeton ni de position dans l'audit ou les journaux.

## 3. Interface (`web/src`)

- Types partagés dans `types.ts`, libellés dans `labels.ts`, appels via `api` (`ApiError` pour les messages).
- Les écrans du jour J se rechargent au signal du direct (`useLive`) : pas de rafraîchissement manuel à ajouter.
- Téléphone d'abord pour la vue terrain et la coordination en direct (gros boutons, une colonne, `data-testid`).
- Formulations prudentes : une suggestion OSM est « à vérifier », jamais une garantie.

## 4. Tests

- Serveur : `server/test/<sujet>.test.ts` avec `setup()`, `Agent`, `createUser`, `createMember`, `memberAgent`
  (`server/test/helpers/app.ts`) et le réseau synthétique `at(x, y)` / `gpxFrom` / `referenceNetwork`
  (`helpers/osm.ts`). Tester les refus (404/403/409), pas seulement le cas nominal.
- Bout en bout : voir le skill `tests-e2e`.

## 5. Documentation (à tenir à jour dans le même commit)

- `docs/guide-organisateur.md` et `docs/guide-membre.md` (affichés dans l'application, page Aide).
- `README.md` (fonctionnalités, configuration, sécurité) ; `docs/CONCEPTION.md` si le modèle change.
- Retirer les mentions devenues fausses plutôt que les laisser.

## 6. Finir

Skill `verifier`, puis commit en français décrivant le changement, sur la branche de travail.
