// Fonds de carte : plan vectoriel par défaut (repli raster s'il est indisponible), Referer envoyé aux serveurs de
// tuiles (sinon 403 chez OSM), changement de fond. Tous les serveurs externes sont simulés.
import { expect, test, type Page } from '@playwright/test';

const H = { 'x-requested-with': 'cortege' };
// PNG transparent de 1 × 1 pixel.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const STYLE = { version: 8, sources: {}, layers: [{ id: 'fond', type: 'background', paint: { 'background-color': '#f2efe9' } }] };

async function setup(page: Page, styleStatus: number) {
  const requests: { host: string; url: string; referer: string | undefined }[] = [];
  for (const host of ['tile.openstreetmap.org', 'data.geopf.fr', 'server.arcgisonline.com', 'tiles.openfreemap.org']) {
    await page.route('https://' + host + '/**', async (route) => {
      requests.push({ host, url: route.request().url(), referer: await route.request().headerValue('referer') ?? undefined });
      if (host === 'tiles.openfreemap.org') return route.fulfill(styleStatus === 200 ? { json: STYLE } : { status: styleStatus, body: '' });
      return route.fulfill({ body: PNG, contentType: 'image/png' });
    });
  }
  await page.route('https://api.panoramax.xyz/**', (route) => route.fulfill({ status: 404, body: '' }));
  await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin-e2e-motdepasse' }, headers: H });
  const ev = await (await page.request.post('/api/events', { data: { name: 'Fonds' }, headers: H })).json();
  await page.goto('/#/evenements/' + ev.id);
  return requests;
}

test('plan vectoriel par défaut, sans tuiles raster', async ({ page }) => {
  const requests = await setup(page, 200);
  await expect(page.getByLabel('Fond de carte')).toHaveValue('vectoriel');
  await expect.poll(() => requests.filter((r) => r.host === 'tiles.openfreemap.org').length).toBeGreaterThan(0);
  await page.waitForTimeout(500);
  expect(requests.filter((r) => r.host === 'tile.openstreetmap.org')).toEqual([]);
  await expect(page.locator('.toast.error')).toHaveCount(0);
});

test('plan vectoriel indisponible : repli sur le plan OSM en images, avec message', async ({ page }) => {
  const requests = await setup(page, 503);
  await expect(page.locator('.toast.error')).toContainText('Plan vectoriel indisponible');
  await expect.poll(() => requests.filter((r) => r.host === 'tile.openstreetmap.org').length).toBeGreaterThan(0);
});

test('tuiles avec Referer, choix du fond conservé', async ({ page }) => {
  const tiles = await setup(page, 200);
  const select = page.getByLabel('Fond de carte');
  await select.selectOption({ label: 'Plan OSM (images)' });
  // Plan OSM demandé avec l'origine du site en Referer (et seulement l'origine).
  await expect.poll(() => tiles.filter((t) => t.host === 'tile.openstreetmap.org').length).toBeGreaterThan(0);
  expect(tiles.find((t) => t.host === 'tile.openstreetmap.org')!.referer).toBe('http://127.0.0.1:3100/');

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
