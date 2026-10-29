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

  // Panoramax est testé à part (e2e/panoramax.spec.ts) : vue désactivée ici.
  await page.addInitScript(() => { localStorage.setItem('cortege.panoramax', 'non'); localStorage.setItem('cortege.fond', 'osm'); });
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
  await expect(page.getByText('Parcours importé.', { exact: true })).toBeVisible();
  await expect(page.locator('.km-marker', { hasText: 'Départ' })).toBeVisible();

  // 3-4. Analyse OSM et examen des suggestions.
  await page.getByRole('tab', { name: /Suggestions/ }).click();
  await page.getByRole('button', { name: 'Lancer l’analyse' }).click();
  await expect(page.getByText(/6\s*nouvelle\(s\)/)).toBeVisible();
  await expect(page.locator('ul.items li')).toHaveCount(6);
  // Un point par accès entrant : la rue B (double sens) donne un accès au nord et un au sud.
  await expect(page.locator('ul.items li', { hasText: /Rue B côté (nord|sud)/ })).toHaveCount(2);
  await page.locator('ul.items li', { hasText: 'Rue B côté nord' }).click();
  await expect(page.getByText('Motif de la détection')).toBeVisible();
  await expect(page.locator('.detail').getByText(/Rue B/).first()).toBeVisible();
  // La suggestion sélectionnée s'ouvre aussi en bulle sur la carte : on la valide depuis la carte.
  const bubble = page.getByTestId('suggestion-popup');
  await expect(bubble).toContainText('Accès véhicules');
  await expect(bubble).toContainText('Rue B côté nord');
  await expect(bubble).toContainText('Rue B');
  await bubble.getByRole('button', { name: 'Valider' }).click();
  await expect(page.getByText('point de mission créé')).toBeVisible();
  // Le point créé s'ouvre directement en modification.
  await expect(page.getByTestId('point-editor').getByLabel('Nom')).toHaveValue('Rue A × Rue B (accès nord)');
  await page.getByTestId('point-editor').getByRole('button', { name: 'Annuler' }).click();

  // 5. Écarter un point inutile, depuis sa bulle.
  await page.getByRole('tab', { name: /Suggestions/ }).click();
  await page.locator('ul.items li', { hasText: 'Accès piéton' }).click();
  await bubble.getByPlaceholder('Motif d’exclusion (facultatif)').fill('Sentier sans enjeu');
  await bubble.getByRole('button', { name: 'Écarter' }).click();
  await expect(page.locator('ul.items li')).toHaveCount(4);
  await expect(bubble).toHaveCount(0);

  // 6. Ajouter manuellement deux points sur la carte : un clic place le point, sa bulle permet de le compléter.
  await page.getByRole('button', { name: '+ Ajouter des points' }).click();
  const map = page.getByTestId('map');
  const box = (await map.boundingBox())!;
  const editor = page.getByTestId('point-editor');
  await map.click({ position: { x: box.width * 0.3, y: box.height * 0.3 } });
  await expect(editor.getByLabel('Nom')).toHaveValue('Point 1');
  // Rien n'est enregistré tant que la bulle n'est pas validée ; un nouveau clic déplace le point provisoire.
  expect((await (await page.request.get('/api/events/' + /evenements\/(\d+)/.exec(page.url())![1] + '/points')).json()).length).toBe(1);
  await map.click({ position: { x: box.width * 0.35, y: box.height * 0.3 } });
  await editor.getByLabel('Type').selectOption('point_fixe');
  await editor.getByRole('button', { name: 'Ajouter' }).click();
  await expect(page.getByText('Point ajouté.')).toBeVisible();
  await expect(page.locator('.point-marker', { hasText: 'Point 1' })).toBeVisible();

  await map.click({ position: { x: box.width * 0.6, y: box.height * 0.3 } });
  await editor.getByLabel('Nom').fill('Angle nord');
  // Ce qu'on voit sur la carte suit la saisie, avant même l'enregistrement.
  await expect(page.locator('.point-marker.draft .point-label')).toHaveText('Angle nord');
  await editor.getByRole('button', { name: 'Ajouter' }).click();
  await expect(page.locator('.point-marker', { hasText: 'Angle nord' })).toBeVisible();
  await page.getByRole('button', { name: 'Terminer l’ajout' }).click();

  // Modifier un point sur la carte : clic sur le marqueur, renommage, glisser-déposer, enregistrement.
  const marker = page.locator('.point-marker', { hasText: 'Angle nord' });
  await marker.click();
  await expect(editor.getByLabel('Nom')).toHaveValue('Angle nord');
  await editor.getByLabel('Nom').fill('Angle nord-est');
  await expect(marker.locator('.point-label')).toHaveText('Angle nord-est');
  const before = await page.locator('.point-marker.selected .point-dot').boundingBox();
  await page.mouse.move(before!.x + before!.width / 2, before!.y + before!.height / 2);
  await page.mouse.down();
  await page.mouse.move(before!.x + 60, before!.y + 40, { steps: 8 });
  await page.mouse.up();
  await expect(editor).toContainText('position modifiée');
  await editor.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Point enregistré.')).toBeVisible();
  await expect(editor).toHaveCount(0);
  const after = await page.locator('.point-marker', { hasText: 'Angle nord-est' }).locator('.point-dot').boundingBox();
  expect(Math.abs(after!.x - before!.x - 60 + before!.width / 2)).toBeLessThan(15);

  // Annuler une modification : rien n'est enregistré, le marqueur reprend son nom.
  await page.locator('.point-marker', { hasText: 'Point 1' }).click();
  await editor.getByLabel('Nom').fill('Brouillon');
  await editor.getByRole('button', { name: 'Annuler' }).click();
  await expect(page.locator('.point-marker', { hasText: 'Point 1' })).toBeVisible();

  await page.getByRole('tab', { name: 'Points' }).click();
  await expect(page.locator('ul.items li')).toHaveCount(3);
  await expect(page.locator('ul.items')).toContainText('Angle nord-est');

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
  for (const name of [/Point 1/, /Rue A × Rue B \(accès nord\)/]) {
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
  await expect(missions.first()).toContainText('Rue A × Rue B (accès nord)');

  // Synthèse : il reste un point validé sans équipe.
  await page.getByRole('tab', { name: 'Synthèse' }).click();
  await expect(page.getByText('Points validés sans équipe (1)')).toBeVisible();
  await page.screenshot({ path: 'docs/apercu-organisateur.png' });
  expect(errors).toEqual([]);
});
