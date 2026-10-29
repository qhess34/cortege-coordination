// Nouveau point : nommé d'après la rue ou le croisement ; bouton « Nom de la rue » pour un point existant.
import { expect, test } from '@playwright/test';
import { at, gpxFrom } from '../server/test/helpers/osm';

const H = { 'x-requested-with': 'cortege' };

test('un nouveau point prend le nom du croisement ; un point existant se renomme d’un clic', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cortege.fond', 'osm'));
  await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin-e2e-motdepasse' }, headers: H });
  const ev = await (await page.request.post('/api/events', { data: { name: 'Noms de rues' }, headers: H })).json();
  await page.request.post('/api/events/' + ev.id + '/tracks', {
    headers: H, multipart: { file: { name: 'a.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(gpxFrom([[[0, 3], [250, -2], [500, 2]]])) } },
  });
  expect((await page.request.post('/api/events/' + ev.id + '/analyses', { data: {}, headers: H })).status()).toBe(201);
  const [lon, lat] = at(105, 4);
  const old = await (await page.request.post('/api/events/' + ev.id + '/points', { data: { name: 'Point 1', position: [lon, lat] }, headers: H })).json();
  await page.goto('/#/evenements/' + ev.id);

  // Nouveau point par coordonnées, au croisement.
  await page.getByRole('tab', { name: /Points/ }).click();
  await page.getByRole('button', { name: '+ Placer un point par coordonnées' }).click();
  await page.getByLabel('Latitude').fill(String(lat));
  await page.getByLabel('Longitude').fill(String(lon));
  await page.getByRole('button', { name: 'Placer sur la carte' }).click();
  const editor = page.getByTestId('point-editor');
  await expect(editor.getByRole('textbox', { name: 'Nom' })).toHaveValue('Rue A × Rue B');
  await editor.getByRole('button', { name: 'Fermer' }).click();

  // Point existant nommé « Point 1 » : le bouton propose le nom de la rue.
  await page.locator('.point-marker', { hasText: 'Point 1' }).locator('.point-dot').click();
  await editor.getByRole('button', { name: 'Nom de la rue' }).click();
  await expect(editor.getByRole('textbox', { name: 'Nom' })).toHaveValue('Rue A × Rue B');
  await editor.getByRole('button', { name: 'Enregistrer' }).click();
  await expect.poll(async () => (await (await page.request.get('/api/points/' + old.id)).json()).name).toBe('Rue A × Rue B');
});
