// Onglet Équipes : répartition des points sans équipe, ordre du cortège, actions secondaires d'une mission.
import { expect, test } from '@playwright/test';
import { openTeam } from './helpers-equipes';
import { at } from '../server/test/helpers/osm';

const H = { 'x-requested-with': 'cortege' };

test('affecter les points sans équipe, confier un point à une autre équipe, ordre du cortège', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('cortege.fond', 'osm'); localStorage.setItem('cortege.panoramax', 'non'); });
  await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin-e2e-motdepasse' }, headers: H });
  const ev = await (await page.request.post('/api/events', { data: { name: 'Répartition' }, headers: H })).json();
  for (const [name, x] of [['Pont', 100], ['Mairie', 200], ['Gare', 300]] as const) {
    await page.request.post('/api/events/' + ev.id + '/points', { data: { name, position: at(x, 0) }, headers: H });
  }
  for (const [name, kind] of [['Balai', 'fermeture'], ['Bleue', 'points'], ['Tête', 'ouverture'], ['Rouge', 'points']] as const) {
    await page.request.post('/api/events/' + ev.id + '/teams', { data: { name, kind, color: '#3a86ff' }, headers: H });
  }
  await page.goto('/#/evenements/' + ev.id);
  await page.getByRole('tab', { name: /Équipes/ }).click();

  // Ordre du cortège : ouverture, points fixes, fermeture.
  await expect(page.locator('.team-head h3')).toHaveText([/^Tête/, 'Bleue', 'Rouge', /^Balai/]);
  await expect(page.locator('.teams-summary')).toContainText('0/3 point(s) affecté(s)');

  // Répartition directe depuis « Points sans équipe ».
  const free = page.getByTestId('points-sans-equipe');
  await free.getByLabel('Affecter « Pont » à une équipe').selectOption({ label: 'Bleue' });
  await expect(free).not.toContainText('Pont');
  await free.getByLabel('Affecter « Mairie » à une équipe').selectOption({ label: 'Bleue' });
  await free.getByLabel('Affecter « Gare » à une équipe').selectOption({ label: 'Rouge' });
  await expect(free).toHaveCount(0);
  await expect(page.getByText('✓ Tous les points ont une équipe.')).toBeVisible();

  // Équipe dépliée : ses points ; menu « ⋯ » : confier « Mairie » à Rouge.
  const bleue = await openTeam(page, 'Bleue', 'Points');
  await expect(bleue.locator('ol.team-points > li')).toHaveCount(2);
  await bleue.getByRole('button', { name: 'Actions pour Mairie' }).click();
  await bleue.getByLabel('Réaffecter').selectOption({ label: 'Rouge' });
  await expect(page.getByText('Mission réaffectée.')).toBeVisible();
  await expect(bleue.locator('ol.team-points > li')).toHaveCount(1);
  const rouge = await openTeam(page, 'Rouge', 'Points');
  await expect(rouge.locator('ol.team-points > li')).toHaveText([/Gare/, /Mairie/]);

  // L'état déplié est mémorisé.
  await page.reload();
  await page.getByRole('tab', { name: /Équipes/ }).click();
  await expect(page.locator('.team-head', { hasText: 'Rouge' })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.team-head', { hasText: 'Balai' })).toHaveAttribute('aria-expanded', 'false');
});
