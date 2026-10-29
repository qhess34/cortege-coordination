// Parcours sur la carte : bouton pour recentrer la carte sur le tracé.
import { expect, test } from '@playwright/test';
import { gpxFrom } from '../server/test/helpers/osm';

const H = { 'x-requested-with': 'cortege' };

test('recentrer la carte sur le parcours', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cortege.fond', 'osm'));
  await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin-e2e-motdepasse' }, headers: H });
  const ev = await (await page.request.post('/api/events', { data: { name: 'Recentrer' }, headers: H })).json();
  await page.request.post('/api/events/' + ev.id + '/tracks', { headers: H, multipart: { file: { name: 'a.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(gpxFrom([[[0, 0], [600, 0]]])) } } });
  await page.goto('/#/evenements/' + ev.id);
  const map = page.getByTestId('map');
  const box = (await map.boundingBox())!;
  const depart = page.locator('.km-marker', { hasText: 'Départ' });
  const inMap = async () => {
    const b = await depart.boundingBox();
    return !!b && b.x > box.x && b.x < box.x + box.width && b.y > box.y && b.y < box.y + box.height;
  };
  await expect.poll(inMap).toBe(true);
  // On éloigne la carte du parcours…
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 2000, box.y + box.height / 2 + 2000, { steps: 20 });
  await page.mouse.up();
  await expect.poll(inMap).toBe(false);
  // … et on y revient.
  await page.getByRole('button', { name: '⤢ Parcours' }).click();
  await expect.poll(inMap).toBe(true);
});
