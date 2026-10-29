// Guides : aide de l'organisation (barre du haut) et des membres (vue terrain).
import { expect, test } from '@playwright/test';
import { invite, signIn } from './helpers-membres';

const H = { 'x-requested-with': 'cortege' };

test('guide de l’organisation et guide des membres accessibles dans l’application', async ({ page, browser }) => {
  await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin-e2e-motdepasse' }, headers: H });
  await page.goto('/#/');
  await page.getByRole('link', { name: 'Aide' }).click();
  const orga = page.getByTestId('guide-orga');
  await expect(orga.getByRole('heading', { level: 1 })).toHaveText('Guide de l’organisation'.replace('’', "'"));
  await orga.getByRole('navigation', { name: 'Sommaire' }).getByRole('link', { name: 'Le jour J : onglet Coordination' }).click();
  await expect(orga.getByRole('heading', { name: 'Le jour J : onglet Coordination' })).toBeInViewport();
  await page.getByRole('tab', { name: 'Membres d’équipe' }).click();
  await expect(page.getByTestId('guide-membre')).toContainText('Activer votre compte');

  // Membre : onglet « ? » de la vue terrain.
  const ev = await (await page.request.post('/api/events', { data: { name: 'Aide' }, headers: H })).json();
  const team = await (await page.request.post('/api/events/' + ev.id + '/teams', { data: { name: 'Équipe Aide', color: '#2a9d8f' }, headers: H })).json();
  const inv = await invite(page, team.id, 'Lina');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-FR', serviceWorkers: 'block' });
  const phone = await ctx.newPage();
  await signIn(phone, inv.path);
  await phone.getByRole('tab', { name: 'Aide' }).click();
  const aide = phone.getByTestId('aide-membre');
  await expect(aide).toContainText('Selon votre type d');
  await expect(aide.locator('blockquote').first()).toContainText('112');
  await ctx.close();
});
