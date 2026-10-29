// Affectation des points aux équipes depuis la carte, couleurs des équipes et légende.
import { expect, test } from '@playwright/test';

const H = { 'x-requested-with': 'cortege' };
const rgb = (hex: string) => 'rgb(' + [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ') + ')';

test('affecter depuis la bulle du point, couleurs et légende', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('cortege.fond', 'osm'); });
  const r = page.request;
  await r.post('/api/auth/login', { data: { login: 'admin', password: 'admin-e2e-motdepasse' }, headers: H });
  const ev = await (await r.post('/api/events', { data: { name: 'Équipes sur la carte' }, headers: H })).json();
  await r.post('/api/events/' + ev.id + '/points', { data: { name: 'Angle', position: [2.35, 48.85] }, headers: H });
  await r.post('/api/events/' + ev.id + '/teams', { data: { name: 'Nord', color: '#e63946' }, headers: H });
  await r.post('/api/events/' + ev.id + '/teams', { data: { name: 'Sud', color: '#1d3557' }, headers: H });
  await page.goto('/#/evenements/' + ev.id);

  const marker = page.locator('.point-marker', { hasText: 'Angle' });
  const dot = marker.locator('.point-dot');
  await expect(dot).toHaveCSS('background-color', 'rgb(73, 80, 87)'); // gris : sans équipe

  // Affecter à Nord depuis la bulle.
  await marker.click();
  const editor = page.getByTestId('point-editor');
  await editor.getByLabel('Nord').check();
  await expect(page.getByText('Point affecté à l’équipe Nord.')).toBeVisible();
  await expect(editor.getByLabel('Nord')).toBeChecked();
  await expect(editor).toContainText('mission n° 1');
  await expect(dot).toHaveCSS('background-color', rgb('#e63946'));

  // Deux équipes : pastille partagée entre les deux couleurs.
  await editor.getByLabel('Sud').check();
  await expect(page.getByText('Point affecté à l’équipe Sud.')).toBeVisible();
  await expect(dot).toHaveCSS('background-image', /conic-gradient/);

  // Retirer de Nord.
  await editor.getByLabel('Nord').uncheck();
  await expect(page.getByText('Point retiré de l’équipe Nord.')).toBeVisible();
  await expect(dot).toHaveCSS('background-color', rgb('#1d3557'));
  await editor.getByRole('button', { name: 'Annuler' }).click();

  // Légende : nombre de points, et masquage des points d'une équipe.
  const legend = page.getByTestId('legende-equipes');
  await expect(legend).toContainText('Sud (1)');
  await expect(legend).toContainText('Nord (0)');
  await legend.getByLabel(/Sud/).uncheck();
  await expect(marker).toHaveCount(0);
  await legend.getByLabel(/Sud/).check();
  await expect(marker).toHaveCount(1);

  // Nouveau point : équipe choisie avant l'ajout.
  await page.getByRole('button', { name: '+ Ajouter des points' }).click();
  const box = (await page.getByTestId('map').boundingBox())!;
  await page.getByTestId('map').click({ position: { x: box.width * 0.3, y: box.height * 0.3 } });
  await editor.getByLabel('Nom').fill('Nouveau');
  await editor.getByLabel('Nord').check();
  await editor.getByRole('button', { name: 'Ajouter' }).click();
  await expect(page.getByText('Point ajouté et affecté.')).toBeVisible();
  await expect(page.locator('.point-marker', { hasText: 'Nouveau' }).locator('.point-dot')).toHaveCSS('background-color', rgb('#e63946'));
  await expect(legend).toContainText('Nord (1)');
});
