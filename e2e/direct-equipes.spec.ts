// Onglet « Direct » de la coordination mobile : état de chaque équipe, raccourcis vers le responsable, prochains points.
import { expect, test } from '@playwright/test';
import { at, gpxFrom } from '../server/test/helpers/osm';

const H = { 'x-requested-with': 'cortege' };

test('direct : statut des équipes, appel / SMS / message au responsable, prochains points devant la tête', async ({ page }) => {
  await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin-e2e-motdepasse' }, headers: H });
  const ev = await (await page.request.post('/api/events', { data: { name: 'Direct équipes' }, headers: H })).json();
  await page.request.post('/api/events/' + ev.id + '/tracks', {
    headers: H, multipart: { file: { name: 'a.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(gpxFrom([[[0, 0], [1000, 0]]])) } },
  });
  const nord = await (await page.request.post('/api/events/' + ev.id + '/teams', { data: { name: 'Nord', color: '#2a9d8f' }, headers: H })).json();
  const sud = await (await page.request.post('/api/events/' + ev.id + '/teams', { data: { name: 'Sud', color: '#e63946' }, headers: H })).json();
  const missions: Record<string, { id: number; version: number }> = {};
  for (const [name, x, team] of [['Rue A', 100, nord], ['Rue B', 400, nord], ['Rue C', 600, sud], ['Rue E', 750, nord], ['Rue D', 900, sud]] as const) {
    const p = await (await page.request.post('/api/events/' + ev.id + '/points', { data: { name, position: at(x, 0) }, headers: H })).json();
    const t = await (await page.request.post('/api/teams/' + team.id + '/missions', { data: { pointId: p.id }, headers: H })).json();
    missions[name] = t.missions.find((m: { pointId: number }) => m.pointId === p.id);
  }
  // Responsable de Nord avec un téléphone.
  const chef = await (await page.request.post('/api/admin/users', { data: { globalRole: 'membre', firstName: 'Alex', lastName: 'Chef', phone: '06 12 34 56 78' }, headers: H })).json();
  await page.request.post('/api/teams/' + nord.id + '/members', { data: { userId: chef.id, role: 'responsable' }, headers: H });
  // Statuts : Nord en route, Sud avec un incident ; tête du cortège à 300 m.
  await page.request.post('/api/missions/' + missions['Rue B']!.id + '/status', { data: { status: 'en_deplacement', version: missions['Rue B']!.version }, headers: H });
  const c = await (await page.request.post('/api/missions/' + missions['Rue C']!.id + '/status', { data: { status: 'en_position', version: missions['Rue C']!.version }, headers: H })).json();
  await page.request.post('/api/missions/' + missions['Rue C']!.id + '/status', { data: { status: 'incident', version: c.version }, headers: H });
  await page.request.post('/api/missions/' + missions['Rue E']!.id + '/status', { data: { status: 'en_position', version: missions['Rue E']!.version }, headers: H });
  // Demande d'aide au point D (l'organisation agit comme responsable de l'équipe).
  await page.request.post('/api/terrain/equipes/' + sud.id + '/incidents', { data: { category: 'aide', description: 'Aide', missionId: missions['Rue D']!.id }, headers: H });
  await page.request.post('/api/events/' + ev.id + '/progression', { data: { part: 'tete', distance: 300 }, headers: H });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/direct/' + ev.id);
  await page.getByRole('tab', { name: /Direct/ }).click();

  const etat = page.getByTestId('etat-equipes');
  const n = etat.getByTestId('etat-equipe-' + nord.id);
  await expect(n).toContainText('En route');
  await expect(n).toContainText('Resp. Alex Chef');
  await expect(n.getByRole('link', { name: 'Appeler Alex Chef' })).toHaveAttribute('href', 'tel:0612345678');
  await expect(n.getByRole('link', { name: 'SMS à Alex Chef' })).toHaveAttribute('href', 'sms:0612345678');
  const s = etat.getByTestId('etat-equipe-' + sud.id);
  await expect(s).toContainText('Incident signalé');
  await expect(s).toContainText('Pas de responsable');

  // Message à l'équipe depuis l'application.
  await n.getByRole('button', { name: 'Message à l’équipe Nord' }).click();
  await n.getByLabel('Message à Nord').fill('Point B : rejoignez la place');
  await n.getByRole('button', { name: 'Envoyer' }).click();
  await expect(page.getByText('Message envoyé à Nord.')).toBeVisible();
  const msgs = await (await page.request.get('/api/events/' + ev.id + '/messages')).json();
  expect(msgs[0]).toMatchObject({ body: 'Point B : rejoignez la place', teamName: 'Nord' });

  // Prochains points devant la tête (300 m), dans l'ordre, avec la distance et leur état.
  const next = page.getByTestId('prochains-points');
  const rows = next.locator('li');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('100 m');
  await expect(rows.nth(0)).toContainText('Rue B');
  await expect(rows.nth(0)).toContainText('Personne · équipe en route');
  await expect(rows.nth(1)).toContainText('Rue C');
  await expect(rows.nth(1)).toContainText('Incident');
  await expect(rows.nth(2)).toContainText('Rue E');
  await expect(rows.nth(2)).toContainText('Équipe en position');
  await expect(rows.nth(3)).toContainText('Rue D');
  await expect(rows.nth(3)).toContainText('Besoin d’aide');
  await expect(next).not.toContainText('Rue A');

  // Carte : le SOS du point D est affiché.
  await page.getByRole('tab', { name: /Carte/ }).click();
  await expect(page.getByTestId('carte-direct').locator('.incident-marker.sos')).toContainText('SOS · Rue D');
});
