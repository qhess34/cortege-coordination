// Déplacer un point en le faisant glisser directement, sans le sélectionner d'abord.
import { expect, test } from '@playwright/test';

const H = { 'x-requested-with': 'cortege' };

test('glisser un point ouvre sa bulle ; enregistrer applique le déplacement, annuler le défait', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cortege.fond', 'osm'));
  await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin-e2e-motdepasse' }, headers: H });
  const ev = await (await page.request.post('/api/events', { data: { name: 'Déplacement' }, headers: H })).json();
  const point = await (await page.request.post('/api/events/' + ev.id + '/points', { data: { name: 'Mobile', position: [2.35, 48.85] }, headers: H })).json();
  await page.goto('/#/evenements/' + ev.id);

  const dot = page.locator('.point-marker', { hasText: 'Mobile' }).locator('.point-dot');
  const drag = async (dx: number, dy: number) => {
    const b = (await dot.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, { steps: 10 });
    await page.mouse.up();
    return b;
  };

  // Annuler : le point revient à sa place, rien n'est enregistré.
  const start = await drag(80, 0);
  const editor = page.getByTestId('point-editor');
  await expect(editor).toContainText('position modifiée');
  await editor.getByRole('button', { name: 'Annuler' }).click();
  await expect.poll(async () => Math.round((await dot.boundingBox())!.x)).toBe(Math.round(start.x));

  // Enregistrer : la nouvelle position est conservée.
  await drag(80, -40);
  await expect(editor).toContainText('position modifiée');
  await editor.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('Point enregistré.')).toBeVisible();
  const saved = await (await page.request.get('/api/points/' + point.id)).json();
  expect(saved.position[0]).toBeGreaterThan(2.35);
  expect(saved.position[1]).toBeGreaterThan(48.85);
});

test('déplacement en passant au-dessus du panneau Panoramax ouvert', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cortege.fond', 'osm'));
  await page.route('https://api.panoramax.xyz/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/search' && url.searchParams.has('bbox')) {
      const [w, s, e, n] = url.searchParams.get('bbox')!.split(',').map(Number);
      return route.fulfill({ json: { type: 'FeatureCollection', features: [{ id: '11111111-2222-3333-4444-555555555555', collection: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', geometry: { type: 'Point', coordinates: [(w! + e!) / 2, (s! + n!) / 2] }, properties: {} }] } });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin-e2e-motdepasse' }, headers: H });
  const ev = await (await page.request.post('/api/events', { data: { name: 'Sous le panneau' }, headers: H })).json();
  await page.request.post('/api/events/' + ev.id + '/points', { data: { name: 'Mobile', position: [2.35, 48.85] }, headers: H });
  await page.goto('/#/evenements/' + ev.id);

  // Ouvre la visionneuse (elle charge la bibliothèque Panoramax et ses styles globaux).
  const map = page.getByTestId('map');
  const box = (await map.boundingBox())!;
  await map.click({ position: { x: box.width * 0.2, y: box.height * 0.3 } });
  await page.getByRole('menuitem', { name: /Voir les photos ici/ }).click();
  await expect(page.locator('pnx-photo-viewer')).toHaveCount(1);
  const panel = (await page.getByTestId('panoramax').boundingBox())!;

  // Glisse le point jusqu'au milieu du panneau : le geste doit aller au bout.
  const dot = page.locator('.point-marker', { hasText: 'Mobile' }).locator('.point-dot');
  const b = (await dot.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(panel.x + panel.width / 2, panel.y + panel.height / 2, { steps: 15 });
  await page.mouse.up();
  await expect(page.getByTestId('point-editor')).toContainText('position modifiée');
  const after = (await dot.boundingBox())!;
  expect(Math.abs(after.x + after.width / 2 - (panel.x + panel.width / 2))).toBeLessThan(5);
  // Le marqueur garde sa taille malgré les styles du viewer.
  expect(Math.round(after.width)).toBe(20);
  // Après le geste, le panneau redevient cliquable.
  await page.getByRole('button', { name: 'Fermer la vue Panoramax' }).click();
  await expect(page.getByTestId('panoramax')).toHaveCount(0);
});
