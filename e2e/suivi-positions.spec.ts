// Suivi des équipes en direct (partage de position facultatif) et arrivée automatique au point.
import { expect, test } from '@playwright/test';
import { invite, signIn } from './helpers-membres';
import { at, gpxFrom } from '../server/test/helpers/osm';

const H = { 'x-requested-with': 'cortege' };

test('position partagée visible au bureau ; arrivée au point détectée ; arrêt = effacement', async ({ page, browser }) => {
  await page.addInitScript(() => { localStorage.setItem('cortege.fond', 'osm'); localStorage.setItem('cortege.panoramax', 'non'); });
  await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin-e2e-motdepasse' }, headers: H });
  const ev = await (await page.request.post('/api/events', { data: { name: 'Suivi en direct' }, headers: H })).json();
  await page.request.post('/api/events/' + ev.id + '/tracks', {
    headers: H, multipart: { file: { name: 'a.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(gpxFrom([[[0, 0], [500, 0]]])) } },
  });
  const team = await (await page.request.post('/api/events/' + ev.id + '/teams', { data: { name: 'Équipe Est', color: '#3a86ff' }, headers: H })).json();
  const point = await (await page.request.post('/api/events/' + ev.id + '/points', { data: { name: 'Angle mairie', position: at(200, 0) }, headers: H })).json();
  await page.request.post('/api/teams/' + team.id + '/missions', { data: { pointId: point.id }, headers: H });
  const inv = await invite(page, team.id, 'Sam');

  // Partage autorisé par l'organisation (Synthèse).
  await page.goto('/#/evenements/' + ev.id);
  await page.getByRole('button', { name: 'Modifier' }).first().click();
  await page.getByLabel('Autoriser le partage de position en direct').check();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText('autorisé (au choix de chaque membre)')).toBeVisible();
  await page.getByRole('tab', { name: 'Coordination' }).click();

  const [lon, lat] = at(100, 5);
  const phoneCtx = await browser.newContext({
    viewport: { width: 390, height: 844 }, locale: 'fr-FR', serviceWorkers: 'block',
    geolocation: { longitude: lon, latitude: lat, accuracy: 8 }, permissions: ['geolocation'],
  });
  const phone = await phoneCtx.newPage();
  await signIn(phone, inv.path);
  const field = phone.getByTestId('vue-terrain');
  const card = field.getByTestId('partage-position');
  await expect(card).toContainText('facultatif');
  await card.getByRole('button', { name: 'Partager ma position' }).click();
  await expect(card).toContainText('Position partagée avec l’organisation');

  // Au bureau : le membre apparaît sur la carte, sans rechargement.
  const marker = page.locator('.member-marker', { hasText: 'Sam' });
  await expect(marker).toBeVisible();
  await expect(page.getByTestId('coord-equipe-' + team.id)).toContainText('📡 1');

  // Le membre arrive au point : la mission passe « en position » toute seule.
  const before = (await marker.boundingBox())!;
  const [lon2, lat2] = at(195, 3);
  await phoneCtx.setGeolocation({ longitude: lon2, latitude: lat2, accuracy: 8 });
  await expect(phone.getByText('Arrivée détectée à « Angle mairie »')).toBeVisible();
  await expect(field.getByTestId('ma-mission')).toContainText('En position');
  await expect(page.getByTestId('coord-equipe-' + team.id)).toContainText('En position');
  await expect.poll(async () => (await marker.boundingBox())!.x).toBeGreaterThan(before.x + 5);

  // Arrêt du partage : la position disparaît du bureau.
  await card.getByRole('button', { name: 'Arrêter' }).click();
  await expect(marker).toHaveCount(0);
  expect((await (await page.request.get('/api/events/' + ev.id + '/positions')).json())).toHaveLength(0);
  await phoneCtx.close();
});
