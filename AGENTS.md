# AGENTS.md

Guide pour les agents IA qui travaillent sur ce dépôt. À lire avant toute modification, avec
[docs/CONCEPTION.md](docs/CONCEPTION.md).

## Règles

1. **Jamais de secret commité** (mots de passe, jetons, liens d'invitation, `.env`). Configuration par variables
   d'environnement (`server/src/config.ts`).
2. **Permissions côté serveur** : toute route qui touche un événement appelle `requireEventRole` ou
   `requireEntityAccess` (`server/src/permissions.ts`). Masquer un bouton ne protège rien.
3. **Suggestions ≠ points** : `map_suggestions` (issues d'OSM) et `mission_points` (retenus par l'organisateur)
   restent séparés. Une nouvelle analyse n'ajoute que des suggestions ; elle ne supprime, ne réinitialise et ne
   réintroduit rien (`server/src/services/merge.ts`).
4. **Pas de suppression silencieuse** : suppression logique et confirmation dès qu'il y a des dépendances ;
   modification importante = entrée `audit()`.
5. **Prudence des formulations** : une suggestion est « à vérifier », jamais une garantie de sécurité ni une
   autorisation.
6. **Géométrie** : `[longitude, latitude]` (ordre GeoJSON), mètres ; calculs purs dans `server/src/geo/`, testés
   sans base.
7. **Aucun appel réseau dans les tests** : réseau OSM synthétique (`server/test/helpers/osm.ts`), faux Overpass.
8. Textes affichés et commentaires en **français**.

## Vérifications avant de proposer un changement

```bash
npm run typecheck
npm test
npx playwright test
```
