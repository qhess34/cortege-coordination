// Roadbook : page imprimable par équipe ou pour toute la manifestation, cartes, GPX, impression PDF.
import { expect, test } from '@playwright/test';
import { gpxFrom } from '../server/test/helpers/osm';

const H = { 'x-requested-with': 'cortege' };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test('roadbook d’équipe et roadbook complet', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cortege.fond', 'osm'));
  await page.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ body: PNG, contentType: 'image/png' }));
  const r = page.request;
  await r.post('/api/auth/login', { data: { login: 'admin', password: 'admin-e2e-motdepasse' }, headers: H });
  const ev = await (await r.post('/api/events', { data: { name: 'Marche roadbook', instructions: 'Gilets jaunes obligatoires.' }, headers: H })).json();
  await r.post('/api/events/' + ev.id + '/tracks', { headers: H, multipart: { file: { name: 'a.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(gpxFrom([[[0, 3], [250, -2], [500, 2]]])) } } });
  await r.post('/api/events/' + ev.id + '/analyses', { data: {}, headers: H });
  const sugg = ((await (await r.get('/api/events/' + ev.id + '/suggestions')).json()) as { id: number; stableKey: string }[]).find((x) => x.stableKey === 'osm:n3-n21')!;
  const p1 = (await (await r.post('/api/suggestions/' + sugg.id + '/validate', { data: {}, headers: H })).json()).pointId;
  const p2 = (await (await r.post('/api/events/' + ev.id + '/points', { data: { name: 'Angle est', description: 'Barrière Vauban', position: [2.353, 48.85] }, headers: H })).json()).id;
  await r.post('/api/events/' + ev.id + '/points', { data: { name: 'Orphelin', position: [2.354, 48.85] }, headers: H });
  const team = await (await r.post('/api/events/' + ev.id + '/teams', { data: { name: 'Nord', color: '#2a9d8f', instructions: 'Rester groupés.' }, headers: H })).json();
  await r.post('/api/teams/' + team.id + '/missions', { data: { pointId: p1 }, headers: H });
  await r.post('/api/teams/' + team.id + '/missions', { data: { pointId: p2, instructions: 'Relève à 15 h' }, headers: H });
  // Accès sud du même carrefour, 40 m plus loin : il doit être regroupé avec l'accès nord.
  const sud = ((await (await r.get('/api/events/' + ev.id + '/suggestions')).json()) as { id: number; stableKey: string }[]).find((x) => x.stableKey === 'osm:n3-n20')!;
  const p3 = (await (await r.post('/api/suggestions/' + sud.id + '/validate', { data: {}, headers: H })).json()).pointId;
  await r.post('/api/teams/' + team.id + '/missions', { data: { pointId: p3 }, headers: H });

  // Depuis l'onglet Équipes.
  await page.goto('/#/evenements/' + ev.id);
  await page.getByRole('tab', { name: 'Équipes' }).click();
  await page.getByRole('link', { name: 'Roadbook de l’équipe Nord' }).click();
  const rb = page.getByTestId('roadbook');
  await expect(rb.getByRole('heading', { name: 'Roadbook — Marche roadbook — Nord' })).toBeVisible();
  await expect(rb).toContainText('Gilets jaunes obligatoires.');
  await expect(rb).toContainText('Rester groupés.');
  await expect(rb.locator('.rb-table tbody tr')).toHaveCount(3);
  // Les deux accès du carrefour forment un seul lieu, avec une seule carte.
  await expect(rb.locator('.rb-point > h3')).toHaveText(['Lieu : Rue A / Rue B — points 1, 3', '2. Angle est']);
  await expect(rb.locator('.rb-point').first().locator('h4')).toHaveText(['1. Accès véhicules — Rue B côté nord (Rue A)', '3. Accès véhicules — Rue B côté sud (Rue A)']);
  await expect(rb).toContainText('Relève à 15 h');
  await expect(rb).toContainText('Rue B');
  await expect(rb).toContainText('Voie d’accès : Rue B — double sens');
  // Pas de données techniques OSM (types de voie, identifiants).
  await expect(rb).not.toContainText('voie OSM');
  await expect(rb).not.toContainText('residential');
  await expect(rb).not.toContainText('openstreetmap.org/?');
  await expect(rb).not.toContainText('Orphelin');
  // Cartes : vue d'ensemble + une par point.
  await expect(rb.locator('img.rb-map')).toHaveCount(3, { timeout: 30_000 });
  expect(await rb.locator('img.rb-map').first().getAttribute('src')).toMatch(/^data:image\/png;base64,/);

  // GPX de l'équipe.
  const href = await page.getByRole('link', { name: 'Télécharger le GPX' }).getAttribute('href');
  const gpx = await page.request.get(href!);
  expect(gpx.headers()['content-type']).toMatch(/gpx/);
  expect(await gpx.text()).toContain('<name>02 Angle est</name>');

  // Impression : barre et boutons masqués ; PDF généré.
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.topbar')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Imprimer / PDF' })).toBeHidden();
  const pdf = await page.pdf({ format: 'A4', path: 'test-results/roadbook-equipe.pdf' });
  expect(pdf.length).toBeGreaterThan(10_000);
  await page.emulateMedia({ media: 'screen' });

  // Roadbook complet : toutes les équipes et les points sans équipe.
  await page.goto('/#/evenements/' + ev.id + '/roadbook');
  await expect(rb.getByRole('heading', { name: 'Roadbook — Marche roadbook', exact: true })).toBeVisible();
  await expect(rb).toContainText('Points sans équipe (1)');
  await expect(rb).toContainText('Orphelin');
});
