// Barre du haut : créer une manifestation, basculer de l'une à l'autre, en supprimer une.
import { expect, test } from '@playwright/test';

const H = { 'x-requested-with': 'cortege' };

test('créer, basculer, supprimer une manifestation', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cortege.fond', 'osm'));
  await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin-e2e-motdepasse' }, headers: H });
  const first = await (await page.request.post('/api/events', { data: { name: 'Marche A' }, headers: H })).json();
  await page.goto('/#/evenements/' + first.id);
  await expect(page.getByRole('heading', { name: 'Marche A' })).toBeVisible();

  // Création depuis la barre du haut.
  await page.getByRole('button', { name: '+ Nouvelle manifestation' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nouvelle manifestation' });
  await dialog.getByLabel('Nom').fill('Marche B');
  await dialog.getByLabel('Zone géographique').fill('Lyon');
  await dialog.getByRole('button', { name: 'Créer' }).click();
  await expect(page.getByRole('heading', { name: 'Marche B' })).toBeVisible();
  const switcher = page.getByLabel('Manifestation', { exact: true });
  await expect(switcher).toHaveValue(/\d+/);
  const idB = new URL(page.url()).hash.split('/').pop()!;

  // Bascule vers la première puis retour.
  await switcher.selectOption({ label: 'Marche A' });
  await expect(page.getByRole('heading', { name: 'Marche A' })).toBeVisible();
  await expect(page).toHaveURL(new RegExp('#/evenements/' + first.id + '$'));
  await switcher.selectOption({ label: 'Marche B' });
  await expect(page.getByRole('heading', { name: 'Marche B' })).toBeVisible();

  // Suppression : bouton désactivé tant que le nom n'est pas retapé.
  await page.getByRole('button', { name: 'Supprimer…' }).click();
  const confirm = page.getByRole('button', { name: 'Supprimer définitivement' });
  await expect(confirm).toBeDisabled();
  await page.getByLabel('Nom de la manifestation à supprimer').fill('Marche b');
  await expect(confirm).toBeDisabled();
  await page.getByLabel('Nom de la manifestation à supprimer').fill('Marche B');
  await confirm.click();
  await expect(page.getByRole('heading', { name: 'Manifestations' })).toBeVisible();
  await expect(switcher.locator('option', { hasText: 'Marche B' })).toHaveCount(0);
  expect((await page.request.get('/api/events/' + idB)).status()).toBe(404);
});
