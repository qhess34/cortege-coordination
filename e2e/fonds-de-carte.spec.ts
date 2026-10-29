// Fonds de carte : Referer envoyé aux serveurs de tuiles (sinon 403 chez OSM) et changement de fond.
// Les serveurs de tuiles sont simulés.
import { expect, test } from '@playwright/test';

const H = { 'x-requested-with': 'cortege' };
// PNG transparent de 1 × 1 pixel.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test('tuiles avec Referer, choix du fond conservé', async ({ page }) => {
  const tiles: { host: string; url: string; referer: string | undefined }[] = [];
  for (const host of ['tile.openstreetmap.org', 'data.geopf.fr', 'server.arcgisonline.com']) {
    await page.route('https://' + host + '/**', async (route) => {
      tiles.push({ host, url: route.request().url(), referer: await route.request().headerValue('referer') ?? undefined });
      return route.fulfill({ body: PNG, contentType: 'image/png' });
    });
  }
  await page.route('https://api.panoramax.xyz/**', (route) => route.fulfill({ status: 404, body: '' }));
  await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin-e2e-motdepasse' }, headers: H });
  const ev = await (await page.request.post('/api/events', { data: { name: 'Fonds' }, headers: H })).json();
  await page.goto('/#/evenements/' + ev.id);

  // Plan OSM par défaut, demandé avec l'origine du site en Referer (et seulement l'origine).
  await expect.poll(() => tiles.filter((t) => t.host === 'tile.openstreetmap.org').length).toBeGreaterThan(0);
  expect(tiles[0]!.referer).toBe('http://127.0.0.1:3100/');

  const select = page.getByLabel('Fond de carte');
  await select.selectOption({ label: 'Photo aérienne IGN (France)' });
  await expect.poll(() => tiles.filter((t) => t.url.includes('LAYER=ORTHOIMAGERY.ORTHOPHOTOS')).length).toBeGreaterThan(0);
  await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('IGN');

  await select.selectOption({ label: 'Satellite (Esri, monde)' });
  await expect.poll(() => tiles.filter((t) => t.host === 'server.arcgisonline.com').length).toBeGreaterThan(0);
  await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('Esri');

  // Le choix est mémorisé dans le navigateur.
  await page.reload();
  await expect(page.getByLabel('Fond de carte')).toHaveValue('satellite');
});
