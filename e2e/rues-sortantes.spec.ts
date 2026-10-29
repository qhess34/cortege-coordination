// Rues sortantes : action groupée pour les écarter, option d'analyse pour ne plus les proposer.
import { expect, test } from '@playwright/test';
import { gpxFrom } from '../server/test/helpers/osm';

const H = { 'x-requested-with': 'cortege' };

test('écarter les rues sortantes et ne plus les proposer', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('cortege.fond', 'osm'); localStorage.setItem('cortege.panoramax', 'non'); });
  await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin-e2e-motdepasse' }, headers: H });
  const ev = await (await page.request.post('/api/events', { data: { name: 'Sortantes' }, headers: H })).json();
  await page.request.post('/api/events/' + ev.id + '/tracks', {
    headers: H, multipart: { file: { name: 'a.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(gpxFrom([[[0, 3], [250, -2], [500, 2]]])) } },
  });
  await page.goto('/#/evenements/' + ev.id);
  await page.getByRole('tab', { name: /Suggestions/ }).click();
  await page.getByRole('button', { name: 'Lancer l’analyse' }).click();
  await expect(page.locator('ul.items li')).toHaveCount(6);

  // Action groupée (avec confirmation).
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Écarter les 1 rue(s) sortante(s) à examiner' }).click();
  await expect(page.getByText('1 rue(s) sortante(s) écartée(s).')).toBeVisible();
  await expect(page.locator('ul.items li')).toHaveCount(5);
  await expect(page.locator('ul.items li', { hasText: 'Rue latérale' })).toHaveCount(0);

  // Option d'analyse : décochée, elle est conservée pour la relance suivante.
  const option = page.getByLabel(/Inclure les rues sortantes/);
  await option.uncheck();
  await page.getByRole('button', { name: 'Relancer l’analyse' }).click();
  await expect(page.getByText(/0\s*nouvelle\(s\)/)).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: /Suggestions/ }).click();
  await expect(page.getByLabel(/Inclure les rues sortantes/)).not.toBeChecked();
});
