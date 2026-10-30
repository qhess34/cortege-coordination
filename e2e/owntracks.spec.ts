// OwnTracks : lien de configuration sur le téléphone, réception des positions (application simulée), arrêt.
import { expect, test } from '@playwright/test';
import { invite, signIn } from './helpers-membres';
import { at, gpxFrom } from '../server/test/helpers/osm';

const H = { 'x-requested-with': 'cortege' };

test('configurer OwnTracks, positions reçues écran éteint, suivi visible et révocable', async ({ page, browser }) => {
  await page.addInitScript(() => { localStorage.setItem('cortege.fond', 'osm'); localStorage.setItem('cortege.panoramax', 'non'); });
  await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin-e2e-motdepasse' }, headers: H });
  const ev = await (await page.request.post('/api/events', { data: { name: 'OwnTracks', locationSharing: true }, headers: H })).json();
  await page.request.post('/api/events/' + ev.id + '/tracks', {
    headers: H, multipart: { file: { name: 'a.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(gpxFrom([[[0, 0], [500, 0]]])) } },
  });
  const team = await (await page.request.post('/api/events/' + ev.id + '/teams', { data: { name: 'Équipe Ouest', color: '#8ac926' }, headers: H })).json();
  const point = await (await page.request.post('/api/events/' + ev.id + '/points', { data: { name: 'Pont', position: at(200, 0) }, headers: H })).json();
  await page.request.post('/api/teams/' + team.id + '/missions', { data: { pointId: point.id }, headers: H });
  const inv = await invite(page, team.id, 'Nour');

  await page.goto('/#/evenements/' + ev.id);
  await page.getByRole('tab', { name: 'Coordination' }).click();
  const orgaCard = page.getByTestId('owntracks-orga');
  await expect(orgaCard).toContainText('Aucun membre');

  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-FR', serviceWorkers: 'block' });
  const phone = await phoneCtx.newPage();
  await signIn(phone, inv.path);
  const card = phone.getByTestId('vue-terrain').getByTestId('owntracks');
  await card.getByRole('button', { name: 'Configurer' }).click();
  await expect(card.getByRole('link', { name: 'Google Play' })).toHaveAttribute('href', /org\.owntracks\.android/);
  await card.getByRole('button', { name: 'Créer mon lien de configuration' }).click();
  const href = (await card.getByTestId('lien-owntracks').getAttribute('href'))!;
  expect(href).toMatch(/^owntracks:\/\/\/config\?inline=/);
  const conf = JSON.parse(Buffer.from(href.split('inline=')[1]!, 'base64').toString('utf8'));
  expect(conf.url).toBe('http://127.0.0.1:3100/api/owntracks');
  expect(conf.waypoints[0].desc).toContain('Pont');
  await card.getByRole('button', { name: 'C’est fait' }).click();
  await expect(card).toContainText('OwnTracks actif');
  await expect(card).toContainText('OwnTracks actif · en attente');

  // L'application (simulée) envoie une position, comme écran éteint.
  const [lon, lat] = at(120, 10);
  const r = await page.request.post('/api/owntracks', {
    headers: { authorization: 'Basic ' + Buffer.from(conf.username + ':' + conf.password).toString('base64'), 'content-type': 'application/json' },
    data: { _type: 'location', lat, lon, acc: 10, batt: 41, tid: conf.tid, tst: Math.floor(Date.now() / 1000), t: 'p' },
  });
  expect(r.status()).toBe(200);
  await expect(page.locator('.member-marker', { hasText: 'Nour' })).toBeVisible();
  await expect(orgaCard).toContainText('Nour');
  await expect(orgaCard).toContainText('41 %');

  // Arrêt par le membre : la position disparaît, l'identifiant est refusé.
  phone.once('dialog', (d) => void d.accept());
  await card.getByRole('button', { name: 'Arrêter' }).click();
  await expect(page.locator('.member-marker', { hasText: 'Nour' })).toHaveCount(0);
  const after = await page.request.post('/api/owntracks', {
    headers: { authorization: 'Basic ' + Buffer.from(conf.username + ':' + conf.password).toString('base64'), 'content-type': 'application/json' },
    data: { _type: 'location', lat, lon, tst: Math.floor(Date.now() / 1000) },
  });
  expect((await after.json())[0]).toMatchObject({ action: 'setConfiguration' });
  await phoneCtx.close();
});
