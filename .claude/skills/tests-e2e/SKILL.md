---
name: tests-e2e
description: Écrire et déboguer les tests de bout en bout Playwright de l'application (organisation au bureau + membres sur téléphone, direct sans rechargement), avec les helpers et les pièges du dépôt.
---

# Tests de bout en bout (Playwright, `e2e/`)

## Préparer les données par l'API

- Se connecter : `page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin-e2e-motdepasse' }, headers: H })`
  avec `const H = { 'x-requested-with': 'cortege' }` (en-tête obligatoire sur toute requête modifiante).
- Parcours : `gpxFrom([[[0, 0], [500, 0]]])` et positions `at(x, y)` (mètres) depuis `server/test/helpers/osm.ts`.
- Membre d'équipe : `invite(page, teamId, 'Prénom')` crée le compte et l'ajoute à l'équipe, puis
  `signIn(phonePage, inv.path)` le connecte par son lien (`e2e/helpers-membres.ts`).
- Onglet Équipes : `openTeam(page, 'Nom', 'Membres' | 'Points' | 'Réglages')` (`e2e/helpers-equipes.ts`).

## Téléphone

```ts
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, locale: 'fr-FR', serviceWorkers: 'block',
  geolocation: { longitude: lon, latitude: lat }, permissions: ['geolocation'],
});
```

Un `userAgent` Android donne des liens `geo:` ; sans, les liens GPS pointent vers Google Maps. Fermer les contextes en
fin de test.

## Bonnes pratiques

- Vérifier le **direct** : l'action sur le téléphone doit apparaître au bureau **sans** `reload()`.
- Sélecteurs par rôle et libellé (`getByRole('button', { name: … })`), `data-testid` pour les blocs. Utiliser
  `exact: true` dès qu'un libellé est le début d'un autre (« Ajouter » / « Ajouter comme responsable »).
- Cartes MapLibre : marqueurs HTML (`.point-marker`, `.member-marker`, `.incident-marker`) ; cliquer avec
  `{ force: true }` si des marqueurs se chevauchent.
- Tuiles : `ctx.route('https://tile.openstreetmap.org/**', …)` pour les simuler ; aucun appel réseau réel.
- Les seuils sont souvent inclusifs à la limite : placer les points de test nettement en deçà (40 m pour « < 50 m »).

## Lancer

`npm run build -w web` puis `npx playwright test e2e/<fichier>.spec.ts` ; la suite complète avant de commiter
(skill `verifier`).
