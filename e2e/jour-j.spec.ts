// Jour J : un membre sur téléphone et l'organisation au bureau, en direct (sans rechargement de page).
import { expect, test } from '@playwright/test';
import { invite, signIn } from './helpers-membres';
import { at, gpxFrom } from '../server/test/helpers/osm';

const H = { 'x-requested-with': 'cortege' };

test('jour J : statut, aide, message urgent et progression circulent en direct', async ({ page, browser }) => {
  await page.addInitScript(() => { localStorage.setItem('cortege.fond', 'osm'); localStorage.setItem('cortege.panoramax', 'non'); });
  await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin-e2e-motdepasse' }, headers: H });
  const ev = await (await page.request.post('/api/events', { data: { name: 'Jour J', instructions: 'Gilet jaune obligatoire.' }, headers: H })).json();
  await page.request.post('/api/events/' + ev.id + '/tracks', {
    headers: H, multipart: { file: { name: 'a.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(gpxFrom([[[0, 0], [500, 0]]])) } },
  });
  const team = await (await page.request.post('/api/events/' + ev.id + '/teams', { data: { name: 'Équipe Nord', color: '#2a9d8f' }, headers: H })).json();
  const point = await (await page.request.post('/api/events/' + ev.id + '/points', { data: { name: 'Carrefour de la Poste', position: at(200, 0) }, headers: H })).json();
  await page.request.post('/api/teams/' + team.id + '/missions', { data: { pointId: point.id }, headers: H });
  const inv = await invite(page, team.id, 'Camille');

  // Organisation : onglet Coordination ouvert, il ne sera plus rechargé.
  await page.goto('/#/evenements/' + ev.id);
  await page.getByRole('tab', { name: 'Coordination' }).click();
  const coord = page.getByTestId('coordination');
  await expect(coord.getByTestId('coord-equipe-' + team.id)).toContainText('Affectée');
  await expect(page.locator('.event-title .sync')).toHaveText('● direct');

  // Téléphone du membre.
  const [lon, lat] = at(150, 10);
  const phoneCtx = await browser.newContext({
    viewport: { width: 390, height: 844 }, locale: 'fr-FR', serviceWorkers: 'block',
    geolocation: { longitude: lon, latitude: lat }, permissions: ['geolocation'],
  });
  const phone = await phoneCtx.newPage();
  await signIn(phone, inv.path);
  const field = phone.getByTestId('vue-terrain');
  await expect(field.getByTestId('ma-mission')).toContainText('Carrefour de la Poste');
  await expect(field.getByTestId('synchro')).toHaveText('● direct');
  await expect(field.getByTestId('carte-terrain')).toBeVisible();

  // 1. « En route » sur le téléphone → visible au bureau sans recharger.
  await field.getByRole('button', { name: 'En route', exact: true }).click();
  await expect(field.getByTestId('ma-mission')).toContainText('En déplacement');
  await expect(coord.getByTestId('coord-equipe-' + team.id)).toContainText('En déplacement');
  await expect(coord.getByTestId('coord-equipe-' + team.id)).toContainText('Camille');
  // L'onglet Équipes de l'organisation suit aussi (données rafraîchies par le direct).
  await field.getByRole('button', { name: 'Arrivé', exact: true }).click();
  await expect(coord.getByTestId('coord-equipe-' + team.id)).toContainText('En position');

  // 2. Aide → incident prioritaire chez l'organisation, pris en charge → visible sur le téléphone.
  await field.getByRole('button', { name: /Aide/ }).click();
  await expect(phone.getByText('Demande d’aide envoyée à l’organisation.')).toBeVisible();
  await expect(coord).toContainText('Besoin d’aide · PRIORITAIRE');
  // Le SOS apparaît aussitôt sur la carte de l'organisation, au point concerné, clignotant tant que personne ne le prend.
  const sosMarker = page.locator('.incident-marker.sos');
  await expect(sosMarker).toHaveCount(1);
  await expect(sosMarker).toContainText('SOS · Carrefour de la Poste');
  await expect(sosMarker).toHaveClass(/ouvert/);
  await expect(field.getByTestId('ma-mission')).toContainText('Incident signalé');
  await coord.getByRole('button', { name: 'Je m’en occupe' }).click();
  await expect(sosMarker).not.toHaveClass(/ouvert/);
  await field.getByRole('tab', { name: /Incidents/ }).click();
  await expect(field.getByTestId('incidents')).toContainText('Pris en charge');

  // 3. Message urgent à tous → bandeau sur le téléphone ; lu → compté au bureau.
  await field.getByRole('tab', { name: 'Mission' }).click();
  const orgaMsgs = coord.getByTestId('messages-orga');
  await orgaMsgs.getByLabel('Message à envoyer').fill('Le cortège part dans 5 minutes');
  await orgaMsgs.getByLabel('Urgent').check();
  await orgaMsgs.getByRole('button', { name: 'Envoyer' }).click();
  await expect(field.getByRole('button', { name: /Message urgent/ })).toBeVisible();
  await field.getByRole('button', { name: /Message urgent/ }).click();
  await expect(field.getByTestId('messages')).toContainText('Le cortège part dans 5 minutes');
  await expect(orgaMsgs).toContainText('lu 1/1');
  // Réponse du terrain.
  await field.getByLabel('Votre message').fill('Bien reçu, on est en place');
  await field.getByRole('button', { name: 'Envoyer' }).click();
  await expect(orgaMsgs).toContainText('Bien reçu, on est en place');

  // 4. Progression (déclarée ici par l'API, sinon calculée par les positions) → distance au point sur le téléphone.
  await page.request.post('/api/events/' + ev.id + '/progression', { data: { part: 'tete', distance: 100 }, headers: H });
  await field.getByRole('tab', { name: 'Mission' }).click();
  await expect(field.getByTestId('progression')).toContainText('0,10 km');
  await expect(field.getByTestId('ma-mission')).toContainText('Tête du cortège à 100 m de ce point.');
  // Un simple membre ne déclare pas la progression.
  await expect(field.getByTestId('progression').getByRole('button', { name: 'Déclarer' })).toHaveCount(0);

  // 5. Mission unique : pas de bouton vers un point suivant, ni « Ma position » ni itinéraire.
  await expect(field.getByRole('link', { name: /Aller au point suivant/ })).toHaveCount(0);
  await expect(field.getByRole('button', { name: 'Itinéraire à pied' })).toHaveCount(0);
  await expect(field.getByRole('button', { name: '📍 Ma position' })).toHaveCount(0);

  // 6. Terminer la mission.
  await field.getByRole('button', { name: 'Reprendre la position' }).click();
  await field.getByRole('button', { name: 'Terminé', exact: true }).click();
  await expect(field).toContainText('Toutes les missions de l’équipe sont terminées.');
  await expect(coord.getByTestId('coord-equipe-' + team.id)).toContainText('Terminée');
  await phoneCtx.close();
});

test('application installable : manifeste, icône et service worker servis', async ({ request }) => {
  const m = await request.get('/manifest.webmanifest');
  expect(m.ok()).toBe(true);
  expect((await m.json()).display).toBe('standalone');
  const sw = await request.get('/sw.js');
  expect(sw.ok()).toBe(true);
  expect(sw.headers()['content-type']).toContain('javascript');
  expect(await sw.text()).toContain("startsWith('/api/')");
  expect((await request.get('/icone.svg')).ok()).toBe(true);
});

test('vue terrain sur téléphone : la page défile, bouton vers le point suivant, points restants, tuiles avec Referer', async ({ page, browser }) => {
  await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin-e2e-motdepasse' }, headers: H });
  const ev = await (await page.request.post('/api/events', { data: { name: 'Téléphone', instructions: 'Consignes.\n'.repeat(40) }, headers: H })).json();
  await page.request.post('/api/events/' + ev.id + '/tracks', {
    headers: H, multipart: { file: { name: 'a.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(gpxFrom([[[0, 0], [500, 0]]])) } },
  });
  const team = await (await page.request.post('/api/events/' + ev.id + '/teams', { data: { name: 'Équipe Sud', color: '#e63946' }, headers: H })).json();
  for (const [name, x] of [['Rond-point', 100], ['Place du marché', 300]] as const) {
    const p = await (await page.request.post('/api/events/' + ev.id + '/points', { data: { name, position: at(x, 0) }, headers: H })).json();
    await page.request.post('/api/teams/' + team.id + '/missions', { data: { pointId: p.id }, headers: H });
  }
  const inv = await invite(page, team.id, 'Lou');

  const ctx = await browser.newContext({
    viewport: { width: 390, height: 700 }, locale: 'fr-FR', serviceWorkers: 'block', hasTouch: true, isMobile: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
  });
  // Plan vectoriel indisponible : la carte se rabat sur les tuiles OSM, qui exigent un Referer.
  await ctx.route('https://tiles.openfreemap.org/**', (r) => r.fulfill({ status: 503, body: '' }));
  const referers: (string | undefined)[] = [];
  await ctx.route('https://tile.openstreetmap.org/**', (r) => {
    referers.push(r.request().headers()['referer']);
    return r.fulfill({ status: 204, body: '' });
  });
  const phone = await ctx.newPage();
  await signIn(phone, inv.path);
  const field = phone.getByTestId('vue-terrain');
  await expect(field.getByTestId('ma-mission')).toContainText('Rond-point');

  // Tuiles demandées avec l'origine du site comme Referer (sinon 403 chez OpenStreetMap).
  await expect.poll(() => referers.length).toBeGreaterThan(0);
  expect(referers.every((r) => r && new URL(r).pathname === '/')).toBe(true);

  // Bouton vers le point suivant : lien geo: sur Android (choix de l'application GPS).
  const gps = field.getByTestId('ma-mission').getByRole('link', { name: 'Aller au point suivant : Place du marché' });
  expect(await gps.getAttribute('href')).toMatch(/^geo:48\.85\d+,2\.35\d+\?q=.*\(Place%20du%20march%C3%A9\)$/);
  // Points restants, avec la distance depuis le point en cours.
  const restants = field.getByTestId('points-restants');
  await expect(restants.locator('summary')).toContainText('Points restants (2)');
  await expect(restants.locator('li').nth(0)).toContainText('point en cours');
  await expect(restants.locator('li').nth(1)).toContainText('+0,20 km');

  // La vue défile jusqu'en bas, sur un écran de téléphone comme sur un grand écran.
  const last = field.locator('summary', { hasText: 'Points restants' });
  for (const size of [{ width: 390, height: 700 }, { width: 1280, height: 700 }]) {
    await phone.setViewportSize(size);
    await expect(last).not.toBeInViewport();
    await phone.mouse.move(size.width / 2, 200);
    await phone.mouse.wheel(0, 4000);
    await expect(last).toBeInViewport();
    await phone.mouse.wheel(0, -8000);
  }
  await ctx.close();
});
