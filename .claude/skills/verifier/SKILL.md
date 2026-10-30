---
name: verifier
description: Lancer correctement les vérifications du dépôt (typecheck, tests serveur et web, e2e Playwright) et éviter les faux échecs connus — base PostgreSQL arrêtée, interface non recompilée pour les e2e, tests instables. À utiliser avant chaque commit.
---

# Vérifier un changement

Dans l'ordre, depuis la racine du dépôt :

```bash
npm run typecheck
npm test
npm run build -w web
npx playwright test
```

## Pièges connus

- **`ECONNREFUSED 127.0.0.1:5432`** : la base de test n'est pas démarrée (`service postgresql start` dans un
  conteneur, sinon `docker compose up -d db`). Les tests serveur utilisent `TEST_DATABASE_URL`
  (défaut `postgres://cortege:cortege@localhost:5432/cortege_test`), **réinitialisée** à chaque exécution.
- **Recompiler l'interface avant les e2e** : `e2e/start-server.sh` sert `web/dist` tel quel. Sans
  `npm run build -w web`, Playwright teste l'ancienne interface (symptôme : un libellé ou un champ ajouté « introuvable »).
- Les e2e utilisent la base `cortege_e2e` (vidée au démarrage), le port 3100, l'administrateur
  `admin` / `admin-e2e-motdepasse`, un faux Overpass (`e2e/mock-overpass.ts`) et bloquent les service workers.
- Un e2e rouge isolé peut être instable : relancer **le fichier seul** ; s'il repasse et que la suite complète passe
  deux fois de suite, ce n'est pas le changement. Sinon c'est un vrai problème : le corriger, jamais le désactiver.
- Pas d'accès aux tuiles ni à Overpass dans le bac à sable : cartes sur fond gris, c'est normal.
- `npx tsc --noEmit -p server` / `-p web` : typecheck ciblé plus rapide pendant le travail.

## Vérification visuelle

Pour regarder un écran : ajouter temporairement `await page.screenshot({ path: '<dossier temporaire>/x.png' })` dans un
spec, le lancer seul, lire l'image, puis **restaurer le spec** (ne jamais commiter de chemin de capture).
`docs/apercu-organisateur.png` est régénérée par `e2e/mvp-organisateur.spec.ts` : la commiter quand elle change.
