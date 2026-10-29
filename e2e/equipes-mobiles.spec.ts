// Équipes sans point fixe : fermeture (queue du cortège) et volante (incidents de toute la manifestation).
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
  return { ctx, field: p.getByTestId('vue-terrain') };
}

test('fermeture : « la queue est ici » ; volante : prend en charge l’incident d’une autre équipe', async ({ page, browser }) => {
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
  await poste.field.getByRole('button', { name: /Aide/ }).click();

  // Volante : voit l'incident de l'équipe Poste et s'en charge.
  const vol = await phoneFor(browser, await inviteMember(volante.id, 'Victor'), at(100, 0));
  await expect(vol.field.getByTestId('role-equipe')).toContainText('1 incident(s) en cours');
  await vol.field.getByTestId('role-equipe').getByRole('button', { name: /incident/ }).click();
  const incidents = vol.field.getByTestId('incidents');
  await expect(incidents).toContainText('Équipe Poste');
  await incidents.getByRole('button', { name: 'J’y vais' }).click();
  await expect(incidents).toContainText('Pris en charge par Victor');
  await expect(coord).toContainText('Pris en charge par Victor');
  // L'équipe Poste voit qui vient.
  await poste.field.getByRole('tab', { name: /Incidents/ }).click();
  await expect(poste.field.getByTestId('incidents')).toContainText('Pris en charge par Victor');
  for (const c of [balai, poste, vol]) await c.ctx.close();
});
