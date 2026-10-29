// Déplacer un point en le faisant glisser directement, sans le sélectionner d'abord.
import { expect, test } from '@playwright/test';
import { gpxFrom } from '../server/test/helpers/osm';

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

test('glisser une suggestion la valide à la position choisie ; un point se saisit aussi par son nom, même en mode ajout', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cortege.fond', 'osm'));
  await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin-e2e-motdepasse' }, headers: H });
  const ev = await (await page.request.post('/api/events', { data: { name: 'Suggestion déplacée' }, headers: H })).json();
  await page.request.post('/api/events/' + ev.id + '/tracks', {
    headers: H, multipart: { file: { name: 'a.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(gpxFrom([[[0, 3], [250, -2], [500, 2]]])) } },
  });
  await page.request.post('/api/events/' + ev.id + '/analyses', { data: {}, headers: H });
  await page.goto('/#/evenements/' + ev.id);
  await page.getByRole('tab', { name: /Suggestions/ }).click();
  await page.locator('ul.items li', { hasText: 'Carrefour' }).click();

  // La bulle est posée juste au-dessus de la suggestion : on en déduit la position de la suggestion à l'écran.
  const bubble = page.getByTestId('suggestion-popup');
  await expect(bubble).toBeVisible();
  const bb = (await page.getByTestId('map-bubble').boundingBox())!;
  const sx = bb.x + bb.width / 2;
  const sy = bb.y + bb.height + 16;
  await page.getByRole('button', { name: 'Fermer' }).first().click();

  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 60, sy - 90, { steps: 12 });
  await page.mouse.up();
  await expect(bubble).toContainText('Déplacée de');
  await expect(page.locator('.point-marker.draft')).toHaveCount(1);
  await bubble.getByRole('button', { name: 'Valider à cette position' }).click();
  await expect(page.getByText('Suggestion validée à la position choisie')).toBeVisible();
  // Le point est posé à l'endroit choisi sans ouvrir sa bulle.
  await expect(page.getByTestId('map-bubble')).toHaveCount(0);
  const marker = page.locator('.point-marker', { hasText: /Carrefour/ });
  const mb = (await marker.locator('.point-dot').boundingBox())!;
  expect(Math.abs(mb.x + mb.width / 2 - (sx + 60))).toBeLessThan(6);
  expect(Math.abs(mb.y + mb.height / 2 - (sy - 90))).toBeLessThan(6);

  // Le nom du point sert aussi de poignée ; le mode ajout n'empêche pas de déplacer un point existant.
  await page.getByRole('button', { name: '+ Ajouter des points' }).click();
  const label = (await marker.locator('.point-label').boundingBox())!;
  await page.mouse.move(label.x + 10, label.y + label.height / 2);
  await page.mouse.down();
  await page.mouse.move(label.x + 10, label.y + label.height / 2 + 70, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByTestId('point-editor')).toContainText('position modifiée');
});
