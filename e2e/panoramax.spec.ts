// Vue Panoramax au clic sur la carte. L'API Panoramax est simulée (aucun appel réseau réel).
import { expect, test, type Page } from '@playwright/test';

const H = { 'x-requested-with': 'cortege' };

async function openEvent(page: Page) {
  await page.addInitScript(() => localStorage.setItem('cortege.fond', 'osm'));
  const r = page.request;
  expect((await r.post('/api/auth/login', { data: { login: 'admin', password: 'admin-e2e-motdepasse' }, headers: H })).ok()).toBe(true);
  const ev = await (await r.post('/api/events', { data: { name: 'Panoramax' }, headers: H })).json();
  await page.goto('/#/evenements/' + ev.id);
  await expect(page.getByRole('heading', { name: 'Panoramax' })).toBeVisible();
}

test('clic sur la carte : menu, photo la plus proche, fermeture', async ({ page }) => {
  const searches: string[] = [];
  let results: unknown[] = [];
  await page.route('https://api.panoramax.xyz/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/search' && url.searchParams.has('bbox')) {
      searches.push(url.searchParams.get('bbox')!);
      return route.fulfill({ json: { type: 'FeatureCollection', features: results } });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await openEvent(page);
  const map = page.getByTestId('map');
  const box = (await map.boundingBox())!;

  const menu = page.getByTestId('map-menu');
  const photosHere = async () => {
    await map.click({ position: { x: box.width / 2, y: box.height / 2 } });
    await menu.getByRole('menuitem', { name: /Voir les photos ici/ }).click();
    await expect(menu).toHaveCount(0);
  };

  // Le clic ouvre un menu ; la recherche de photo n'a lieu qu'à la demande.
  await map.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Ajouter un point ici/ })).toBeVisible();
  expect(searches).toHaveLength(0);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  // Aucune photo à proximité.
  await photosHere();
  const panel = page.getByTestId('panoramax');
  await expect(panel).toContainText('Aucune photo Panoramax à moins de 50 m');
  expect(searches).toHaveLength(1);

  // Une photo proche : le viewer Panoramax est créé sur cette photo.
  const [w, s, e, n] = searches[0]!.split(',').map(Number);
  results = [{ id: '11111111-2222-3333-4444-555555555555', collection: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', geometry: { type: 'Point', coordinates: [(w! + e!) / 2, (s! + n!) / 2] }, properties: { datetime: '2025-06-01T10:00:00Z' } }];
  await photosHere();
  await expect(panel).toContainText(/Photo © contributeurs Panoramax/);
  const viewer = panel.locator('pnx-photo-viewer');
  await expect(viewer).toHaveAttribute('picture', '11111111-2222-3333-4444-555555555555');
  await expect(viewer).toHaveAttribute('url-parameters', 'false');
  for (const el of await panel.locator('pnx-bottom-drawer, pnx-widget-legend, pnx-time-travel').all()) await expect(el).toBeHidden();
  await expect(panel.getByRole('link', { name: 'Ouvrir sur Panoramax' })).toHaveAttribute('href', /pic=11111111/);
  // Le viewer ne modifie pas l'adresse de la page.
  expect(new URL(page.url()).hash).toMatch(/^#\/evenements\/\d+$/);

  await page.getByRole('button', { name: 'Fermer la vue Panoramax' }).click();
  await expect(panel).toHaveCount(0);

  expect(searches).toHaveLength(2);
});
