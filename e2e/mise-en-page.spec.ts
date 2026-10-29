// Mise en page : faire défiler le panneau de droite ne doit pas faire défiler la page ni déplacer la carte.
import { expect, test } from '@playwright/test';

const H = { 'x-requested-with': 'cortege' };

test('le panneau de droite défile seul, la carte reste en place', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('cortege.panoramax', 'non'); localStorage.setItem('cortege.fond', 'osm'); });
  await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin-e2e-motdepasse' }, headers: H });
  const ev = await (await page.request.post('/api/events', { data: { name: 'Défilement' }, headers: H })).json();
  for (let i = 1; i <= 30; i++) {
    await page.request.post('/api/events/' + ev.id + '/points', { data: { name: 'Point ' + i, position: [2.35 + i * 0.0005, 48.85] }, headers: H });
  }
  await page.goto('/#/evenements/' + ev.id);
  await page.getByRole('tab', { name: 'Points' }).click();
  await expect(page.locator('ul.items li')).toHaveCount(30);

  const map = page.getByTestId('map');
  const before = await map.boundingBox();
  const panel = page.locator('.panel');
  await panel.hover();
  for (let i = 0; i < 10; i++) await page.mouse.wheel(0, 400);

  await expect.poll(() => panel.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
  expect(await map.boundingBox()).toEqual(before);
});
