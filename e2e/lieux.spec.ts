// Carrefours : les accès proches se regroupent depuis la bulle d'un point (jamais d'office) ; GPX et suivi par carrefour.
import { expect, test } from '@playwright/test';
import { at, gpxFrom } from '../server/test/helpers/osm';

const H = { 'x-requested-with': 'cortege' };

test('regrouper deux accès en un carrefour : bulle du point, GPX par carrefour, suivi « x/y accès tenus »', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('cortege.fond', 'osm'); localStorage.setItem('cortege.panoramax', 'non'); });
  await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin-e2e-motdepasse' }, headers: H });
  const ev = await (await page.request.post('/api/events', { data: { name: 'Carrefours' }, headers: H })).json();
  await page.request.post('/api/events/' + ev.id + '/tracks', {
    headers: H, multipart: { file: { name: 'a.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(gpxFrom([[[0, 0], [600, 0]]])) } },
  });
  const team = await (await page.request.post('/api/events/' + ev.id + '/teams', { data: { name: 'Nord', color: '#2a9d8f' }, headers: H })).json();
  const ids: Record<string, number> = {};
  for (const [name, x, y] of [['Place A (accès nord)', 200, 20], ['Place A (accès sud)', 200, -20], ['Rue lointaine', 500, 0]] as const) {
    const p = await (await page.request.post('/api/events/' + ev.id + '/points', { data: { name, position: at(x, y) }, headers: H })).json();
    ids[name] = p.id;
    await page.request.post('/api/teams/' + team.id + '/missions', { data: { pointId: p.id }, headers: H });
  }

  // Bulle du point : le point voisin (50 m) est proposé, pas le point lointain.
  await page.goto('/#/evenements/' + ev.id);
  await page.locator('.point-marker', { hasText: 'Place A (accès nord)' }).locator('.point-dot').click({ force: true });
  const lieu = page.getByTestId('point-editor').getByTestId('lieu-du-point');
  await expect(lieu).toContainText('Place A (accès sud)');
  await expect(lieu).not.toContainText('Rue lointaine');
  await lieu.getByRole('button', { name: 'Regrouper' }).click();
  await expect(page.getByText('Points regroupés en un carrefour.')).toBeVisible();
  await expect(lieu).toContainText('Place A · 2 accès regroupés');

  // GPX de l'équipe : un POI pour le carrefour, un pour le point lointain ; par accès sur option.
  const names = (gpx: string) => [...gpx.matchAll(/<wpt [^>]*><name>([^<]*)<\/name>/g)].map((m) => m[1]);
  expect(names(await (await page.request.get('/api/events/' + ev.id + '/roadbook.gpx?team=' + team.id)).text()))
    .toEqual(['01 Place A (2 accès)', '02 Rue lointaine']);
  expect(names(await (await page.request.get('/api/events/' + ev.id + '/roadbook.gpx?team=' + team.id + '&regroupement=acces')).text())).toHaveLength(3);

  // Suivi : une ligne pour le carrefour, « 1/2 accès tenus » quand un seul accès est en position.
  const teams = await (await page.request.get('/api/events/' + ev.id + '/teams')).json();
  const m = teams[0].missions.find((x: { pointId: number }) => x.pointId === ids['Place A (accès nord)']);
  await page.request.post('/api/missions/' + m.id + '/status', { data: { status: 'en_position', version: m.version }, headers: H });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/direct/' + ev.id);
  await page.getByRole('tab', { name: /Direct/ }).click();
  const rows = page.getByTestId('prochains-points').locator('li');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Place A');
  await expect(rows.nth(0)).toContainText('1/2 accès tenus');
  await expect(rows.nth(0)).toContainText('Équipe en position');
  await expect(rows.nth(1)).toContainText('Rue lointaine');

  // Séparer : chaque accès redevient un point seul.
  expect((await page.request.post('/api/points/' + ids['Place A (accès sud)'] + '/separer', { headers: H })).ok()).toBe(true);
  await page.reload();
  await expect(page.getByTestId('prochains-points').locator('li')).toHaveCount(3);
});
