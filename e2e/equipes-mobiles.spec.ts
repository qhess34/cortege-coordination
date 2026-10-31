// Équipes sans point fixe : fermeture (queue du cortège) et volante (SOS de toute la manifestation).
import { expect, test, type Browser } from '@playwright/test';
import { invite, signIn } from './helpers-membres';
import { at, gpxFrom } from '../server/test/helpers/osm';

const H = { 'x-requested-with': 'cortege' };

async function phoneFor(browser: Browser, path: string, position: [number, number]) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, locale: 'fr-FR', serviceWorkers: 'block',
    geolocation: { longitude: position[0], latitude: position[1] }, permissions: ['geolocation'],
  });
  const p = await ctx.newPage();
  await signIn(p, path);
  return { ctx, page: p, field: p.getByTestId('vue-terrain') };
}

test('fermeture : « la queue est ici » ; volante : lien vers le lieu du SOS et de la relève, résout le SOS d’une autre équipe', async ({ page, browser }) => {
  await page.addInitScript(() => { localStorage.setItem('cortege.fond', 'osm'); localStorage.setItem('cortege.panoramax', 'non'); });
  await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin-e2e-motdepasse' }, headers: H });
  const ev = await (await page.request.post('/api/events', { data: { name: 'Équipes mobiles' }, headers: H })).json();
  await page.request.post('/api/events/' + ev.id + '/tracks', {
    headers: H, multipart: { file: { name: 'a.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(gpxFrom([[[0, 0], [500, 0]]])) } },
  });
  const mk = async (name: string, kind: string) => (await page.request.post('/api/events/' + ev.id + '/teams', { data: { name, color: '#6a4c93', kind }, headers: H })).json();
  const fixe = await mk('Équipe Poste', 'points');
  const fermeture = await mk('Balai', 'fermeture');
  const volante = await mk('Volante 1', 'volante');
  const point = await (await page.request.post('/api/events/' + ev.id + '/points', { data: { name: 'Carrefour Poste', position: at(200, 0) }, headers: H })).json();
  await page.request.post('/api/teams/' + fixe.id + '/missions', { data: { pointId: point.id }, headers: H });
  const inviteMember = async (teamId: number, name: string) => (await invite(page, teamId, name)).path;

  await page.goto('/#/evenements/' + ev.id);
  await page.getByRole('tab', { name: 'Coordination' }).click();
  const coord = page.getByTestId('coordination');
  await expect(coord.getByTestId('coord-equipe-' + fermeture.id)).toContainText('fermeture');

  // Fermeture : rôle expliqué, déclaration de la queue par la position du téléphone.
  const balai = await phoneFor(browser, await inviteMember(fermeture.id, 'Fanny'), at(260, 8));
  await expect(balai.field.getByTestId('role-equipe')).toContainText('Fermeture');
  await balai.field.getByRole('button', { name: '📍 La queue est ici' }).click();
  await expect(balai.field.getByTestId('progression-queue')).toContainText('0,26 km');
  await expect(balai.field.getByTestId('role-equipe')).toContainText('1 point(s) dépassé(s), encore tenu(s) : Carrefour Poste');
  await expect(coord.getByTestId('coord-equipe-' + fixe.id)).toContainText('à lever');
  // Elle ne déclare pas la tête.
  await expect(balai.field.getByRole('button', { name: '📍 La tête est ici' })).toHaveCount(0);

  // L'équipe du point est prévenue.
  const poste = await phoneFor(browser, await inviteMember(fixe.id, 'Paul'), at(200, 0));
  await expect(poste.field.getByTestId('queue-passee')).toBeVisible();
  await poste.field.getByRole('button', { name: /🆘 SOS/ }).click();
  await poste.field.getByRole('button', { name: /Envoyer le SOS/ }).click();

  // Volante : voit le SOS de l'équipe Poste et le résout.
  const vol = await phoneFor(browser, await inviteMember(volante.id, 'Victor'), at(100, 0));
  await expect(vol.field.getByTestId('role-equipe')).toContainText('1 SOS en cours');
  // SOS : lien direct vers le lieu (sans position jointe, le point de la mission concernée).
  const sos = vol.field.getByTestId('role-equipe').locator('.sos-alert');
  await expect(sos).toContainText('Besoin de renforts · Carrefour Poste (Équipe Poste)');
  const join = sos.getByRole('link', { name: /Rejoindre le lieu/ });
  await expect(join).toContainText('point « Carrefour Poste »');
  const [plon, plat] = at(200, 0);
  expect(await join.getAttribute('href')).toContain(plat.toFixed(6) + ',' + plon.toFixed(6));
  await vol.field.getByTestId('role-equipe').getByRole('button', { name: /SOS en cours/ }).click();
  const sosList = vol.field.getByTestId('sos');
  await expect(sosList).toContainText('Équipe Poste');
  await expect(sosList.getByRole('link', { name: /Rejoindre le lieu/ })).toBeVisible();
  await expect(coord).toContainText('Besoin de renforts'); // l'organisation voit le SOS ouvert
  await sosList.getByRole('button', { name: 'Résolu' }).click();
  await expect(sosList).toContainText('Résolu par Victor');
  // L'équipe Poste voit qui a résolu.
  await poste.field.getByRole('tab', { name: /SOS/ }).click();
  await expect(poste.field.getByTestId('sos')).toContainText('Résolu par Victor');
  // Relève demandée au point de l'équipe Poste : l'équipe volante est prévenue, avec le lien GPS vers le point.
  await vol.field.getByRole('tab', { name: 'Mission' }).click();
  const teamsNow = await (await page.request.get('/api/events/' + ev.id + '/teams')).json();
  const m = teamsNow.find((x: { id: number }) => x.id === fixe.id).missions[0];
  let version = m.version;
  if (m.status !== 'en_position') {
    version = (await (await page.request.post('/api/missions/' + m.id + '/status', { data: { status: 'en_position', version }, headers: H })).json()).version;
  }
  const r = await page.request.post('/api/missions/' + m.id + '/status', { data: { status: 'releve_necessaire', version }, headers: H });
  expect(r.ok(), await r.text()).toBe(true);
  await expect(vol.page.getByRole('status').filter({ hasText: 'Relève nécessaire · Carrefour Poste' })).toBeVisible();
  const releve = vol.field.getByTestId('releve-' + m.id);
  await expect(releve).toContainText('Relève nécessaire · Carrefour Poste (Équipe Poste)');
  const toPoint = releve.getByRole('link', { name: /Rejoindre le lieu/ });
  await expect(toPoint).toContainText('Rejoindre le point « Carrefour Poste »');
  expect(await toPoint.getAttribute('href')).toContain(plat.toFixed(6) + ',' + plon.toFixed(6));
  for (const c of [balai, poste, vol]) await c.ctx.close();
});
