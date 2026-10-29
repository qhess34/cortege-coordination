// Parcours MVP de l'organisateur, de bout en bout, dans un vrai navigateur.
import { expect, test } from '@playwright/test';
import { gpxFrom } from '../server/test/helpers/osm';

const H = { 'x-requested-with': 'cortege' };

test('organisateur : événement, GPX, analyse, points, équipes', async ({ page, request }) => {
  // Erreurs du navigateur (hors tuiles, inaccessibles dans l'environnement de test).
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|tile/i.test(m.text())) errors.push(m.text());
  });
  // L'administrateur crée le compte de l'organisateur (aucune inscription publique).
  expect((await request.post('/api/auth/login', { data: { login: 'admin', password: 'admin-e2e-motdepasse' }, headers: H })).ok()).toBe(true);
  const created = await request.post('/api/admin/users', {
    data: { login: 'orga', displayName: 'Camille Orga', password: 'orga-e2e-motdepasse', globalRole: 'organisateur' },
    headers: H,
  });
  expect(created.status()).toBe(201);

  await page.goto('/');
  await expect(page.getByText("Il n'y a pas d'inscription en ligne")).toBeVisible();
  await page.getByLabel('Identifiant').fill('orga');
  await page.getByLabel('Mot de passe').fill('orga-e2e-motdepasse');
  await page.getByRole('button', { name: 'Se connecter' }).click();

  // 1. Créer un événement.
  await page.getByLabel('Nom').fill('Marche test');
  await page.getByRole('button', { name: 'Créer' }).click();
  await expect(page.getByRole('heading', { name: 'Marche test' })).toBeVisible();
  await expect(page.getByText('Aucun parcours importé')).toBeVisible();

  // 2. Importer un GPX (aperçu puis import).
  await page.getByRole('tab', { name: 'Parcours' }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'rue-a.gpx',
    mimeType: 'application/gpx+xml',
    buffer: Buffer.from(gpxFrom([[[0, 3], [250, -2], [500, 2]]], 'Rue A')),
  });
  await expect(page.getByText(/0,50 km, 1 segment/)).toBeVisible();
  await page.getByRole('button', { name: 'Importer' }).click();
  await expect(page.getByText('Parcours importé.')).toBeVisible();
  await expect(page.locator('.km-marker', { hasText: 'Départ' })).toBeVisible();

  // 3-4. Analyse OSM et examen des suggestions.
  await page.getByRole('tab', { name: /Suggestions/ }).click();
  await page.getByRole('button', { name: 'Lancer l’analyse' }).click();
  await expect(page.getByText(/6\s*nouvelle\(s\)/)).toBeVisible();
  await expect(page.locator('ul.items li')).toHaveCount(6);
  await page.locator('ul.items li', { hasText: 'Carrefour' }).click();
  await expect(page.getByText('Motif de la détection')).toBeVisible();
  await expect(page.locator('.detail').getByText(/Rue B/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Valider' }).click();
  await expect(page.getByText('point de mission créé')).toBeVisible();

  // 5. Écarter un point inutile.
  await page.getByRole('tab', { name: /Suggestions/ }).click();
  await page.locator('ul.items li', { hasText: 'Accès piéton' }).click();
  await page.getByPlaceholder('Motif (facultatif)').fill('Sentier sans enjeu');
  await page.getByRole('button', { name: 'Écarter' }).click();
  await expect(page.locator('ul.items li')).toHaveCount(4);

  // 6. Ajouter manuellement deux points en cliquant sur la carte.
  await page.getByRole('button', { name: '+ Ajouter des points' }).click();
  const map = page.getByTestId('map');
  const box = (await map.boundingBox())!;
  await map.click({ position: { x: box.width * 0.3, y: box.height * 0.3 } });
  await expect(page.getByText('Point ajouté.')).toBeVisible();
  await map.click({ position: { x: box.width * 0.6, y: box.height * 0.3 } });
  await page.getByRole('button', { name: 'Terminer l’ajout' }).click();
  await page.getByRole('tab', { name: 'Points' }).click();
  await expect(page.locator('ul.items li')).toHaveCount(3);

  // 7. Relancer l'analyse sans perdre les modifications.
  await page.getByRole('tab', { name: /Suggestions/ }).click();
  await page.getByRole('button', { name: 'Relancer l’analyse' }).click();
  await expect(page.getByText(/0\s*nouvelle\(s\), 5\s*déjà présente\(s\), 1\s*écartée\(s\) ignorée\(s\)/)).toBeVisible();
  await page.getByRole('tab', { name: 'Points' }).click();
  await expect(page.locator('ul.items li')).toHaveCount(3);

  // 8-9. Créer une équipe et lui affecter les missions dans l'ordre voulu.
  await page.getByRole('tab', { name: 'Équipes' }).click();
  await page.getByPlaceholder('Nom de la nouvelle équipe').fill('Équipe Nord');
  await page.getByRole('button', { name: 'Créer' }).click();
  await expect(page.getByRole('heading', { name: 'Équipe Nord' })).toBeVisible();
  for (const name of [/Point 1/, /Carrefour/]) {
    const select = page.getByLabel('Point à affecter');
    const value = await select.locator('option', { hasText: name }).getAttribute('value');
    await select.selectOption(value!);
    await page.getByRole('button', { name: 'Affecter', exact: true }).click();
    await expect(page.getByText('Point affecté.')).toBeVisible();
  }
  const missions = page.locator('ol.missions > li');
  await expect(missions).toHaveCount(2);
  await expect(missions.first()).toContainText('Point 1');
  await missions.nth(1).getByRole('button', { name: 'Monter' }).click();
  await expect(missions.first()).toContainText('Carrefour');

  // Synthèse : il reste un point validé sans équipe.
  await page.getByRole('tab', { name: 'Synthèse' }).click();
  await expect(page.getByText('Points validés sans équipe (1)')).toBeVisible();
  await page.screenshot({ path: 'docs/apercu-organisateur.png' });
  expect(errors).toEqual([]);
});
