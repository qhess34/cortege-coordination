// Rues sortantes : pas proposées par défaut ; option pour les inclure ; action groupée pour les écarter.
import { expect, test } from '@playwright/test';
import { gpxFrom } from '../server/test/helpers/osm';

const H = { 'x-requested-with': 'cortege' };

test('rues sortantes : option, action groupée, choix mémorisé', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('cortege.fond', 'osm'); localStorage.setItem('cortege.panoramax', 'non'); });
  await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin-e2e-motdepasse' }, headers: H });
  const ev = await (await page.request.post('/api/events', { data: { name: 'Sortantes' }, headers: H })).json();
  await page.request.post('/api/events/' + ev.id + '/tracks', {
    headers: H, multipart: { file: { name: 'a.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(gpxFrom([[[0, 3], [250, -2], [500, 2]]])) } },
  });
  await page.goto('/#/evenements/' + ev.id);
  await page.getByRole('tab', { name: /Suggestions/ }).click();
  const option = page.getByLabel(/Inclure les rues sortantes/);
  await expect(option).not.toBeChecked();
  await expect(page.getByLabel(/Un point par accès entrant/)).toBeChecked();
  await page.getByRole('button', { name: 'Lancer l’analyse' }).click();
  await expect(page.locator('ul.items li')).toHaveCount(6);
  await expect(page.locator('ul.items li', { hasText: 'Rue latérale' })).toHaveCount(0);

  // Les inclure : la rue sortante est ajoutée.
  await option.check();
  await page.getByRole('button', { name: 'Relancer l’analyse' }).click();
  await expect(page.getByText(/1\s*nouvelle\(s\)/)).toBeVisible();
  await expect(page.locator('ul.items li', { hasText: 'Rue latérale' })).toHaveCount(1);

  // Les écarter en une fois (avec confirmation).
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Écarter les 1 rue(s) sortante(s) à examiner' }).click();
  await expect(page.getByText('1 rue(s) sortante(s) écartée(s).')).toBeVisible();
  await expect(page.locator('ul.items li', { hasText: 'Rue latérale' })).toHaveCount(0);

  // Accès piétons déjà proposés : écartés en une fois ; décocher l'option évite qu'ils reviennent.
  await expect(page.locator('ul.items li', { hasText: 'Accès piéton' })).toHaveCount(1);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Écarter les 1 accès piéton(s) ou cyclable(s) à examiner' }).click();
  await expect(page.getByText('1 accès piéton(s) ou cyclable(s) écarté(s).')).toBeVisible();
  await expect(page.locator('ul.items li', { hasText: 'Accès piéton' })).toHaveCount(0);
  await page.getByLabel(/Inclure les accès piétons/).uncheck();
  await page.getByRole('button', { name: 'Relancer l’analyse' }).click();
  await expect(page.getByText(/0\s*nouvelle\(s\)/)).toBeVisible();
  await expect(page.locator('ul.items li', { hasText: 'Accès piéton' })).toHaveCount(0);

  // Le choix des options est repris à la relance suivante.
  await page.reload();
  await page.getByRole('tab', { name: /Suggestions/ }).click();
  await expect(page.getByLabel(/Inclure les rues sortantes/)).toBeChecked();
  await expect(page.getByLabel(/Inclure les accès piétons/)).not.toBeChecked();
});
