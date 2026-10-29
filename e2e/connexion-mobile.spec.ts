// Première page (mot de passe ou lien), connexion d'un téléphone par lien, coordination en direct sur mobile.
import { expect, test } from '@playwright/test';
import { at, gpxFrom } from '../server/test/helpers/osm';

const H = { 'x-requested-with': 'cortege' };
const PHONE = { viewport: { width: 390, height: 844 }, locale: 'fr-FR', serviceWorkers: 'block' as const, isMobile: true, hasTouch: true };

test('première page : identifiant ou lien de connexion, aide à l’installation', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Coordination de cortège' })).toBeVisible();
  await expect(page.getByText('Membre d’une équipe ?')).toBeVisible();
  await page.getByRole('tab', { name: 'Lien de connexion' }).click();
  await expect(page.getByText('Connecter un appareil')).toBeVisible();
  // Pas de serveur d'e-mails dans cet environnement : pas de formulaire d'envoi.
  await expect(page.getByRole('button', { name: 'Envoyer le lien' })).toHaveCount(0);
  const install = page.getByTestId('installer');
  await install.getByRole('button', { name: 'Comment ?' }).click();
  await expect(install).toContainText('Installer l’application');
  await page.getByRole('tab', { name: 'Identifiant' }).click();
  await page.getByLabel('Identifiant').fill('admin');
  await page.getByLabel('Mot de passe').fill('admin-e2e-motdepasse');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('heading', { name: 'Manifestations' })).toBeVisible();
});

test('connecter son téléphone par QR code, puis coordonner en direct depuis le téléphone', async ({ page, browser }) => {
  await page.addInitScript(() => { localStorage.setItem('cortege.fond', 'osm'); localStorage.setItem('cortege.panoramax', 'non'); });
  await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin-e2e-motdepasse' }, headers: H });
  const ev = await (await page.request.post('/api/events', { data: { name: 'Cortège mobile' }, headers: H })).json();
  await page.request.post('/api/events/' + ev.id + '/tracks', {
    headers: H, multipart: { file: { name: 'a.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(gpxFrom([[[0, 0], [500, 0]]])) } },
  });
  const team = await (await page.request.post('/api/events/' + ev.id + '/teams', { data: { name: 'Équipe Rive', color: '#2a9d8f' }, headers: H })).json();
  const point = await (await page.request.post('/api/events/' + ev.id + '/points', { data: { name: 'Quai', position: at(200, 0) }, headers: H })).json();
  await page.request.post('/api/teams/' + team.id + '/missions', { data: { pointId: point.id }, headers: H });
  const inv = await (await page.request.post('/api/teams/' + team.id + '/invitations', { data: { kind: 'equipe', admission: 'immediate' }, headers: H })).json();

  // Ordinateur : « Connecter un appareil » affiche un QR code.
  await page.goto('/#/');
  await page.getByRole('button', { name: '📱 Connecter un appareil' }).click();
  await expect(page.getByTestId('qr-connexion')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('une seule fois');
  // Le téléphone ouvre le lien contenu dans le QR code (récupéré ici par l'API, faute de lire l'image).
  const link = await (await page.request.post('/api/auth/liens', { headers: H })).json();
  const phoneCtx = await browser.newContext(PHONE);
  const phone = await phoneCtx.newPage();
  await phone.goto(link.path);
  await expect(phone.getByTestId('lien-connexion')).toContainText('Admin E2E');
  await phone.getByRole('button', { name: 'Se connecter' }).click();
  await expect(phone.getByRole('heading', { name: 'Manifestations' })).toBeVisible();
  expect(new URL(phone.url()).pathname).toBe('/');
  // Le lien ne resservira pas.
  const reuse = await (await browser.newContext(PHONE)).newPage();
  await reuse.goto(link.path);
  await expect(reuse.getByTestId('lien-connexion')).toContainText('déjà servi');

  // Téléphone : coordination en direct.
  await phone.getByTestId('manifestation-' + ev.id).getByRole('link', { name: '📱 Coordination en direct' }).click();
  const live = phone.getByTestId('coordination-mobile');
  await expect(live.locator('.sync')).toHaveText('● direct');
  await expect(live).toContainText('En position');
  await live.getByRole('tab', { name: /Équipes/ }).click();
  await expect(live.getByTestId('coord-equipe-' + team.id)).toContainText('Quai');

  // Un membre signale un besoin d'aide : badge et incident sur le téléphone de l'organisation, sans recharger.
  const memberCtx = await browser.newContext(PHONE);
  const member = await memberCtx.newPage();
  await member.goto(inv.path);
  await member.getByLabel('Votre nom ou pseudonyme').fill('Yann');
  await member.getByRole('button', { name: 'Rejoindre l’équipe' }).click();
  await member.getByTestId('vue-terrain').getByRole('button', { name: /Aide/ }).click();
  const incidentsTab = live.getByRole('tab', { name: /Incidents/ });
  await expect(incidentsTab.locator('.count')).toHaveText('1');
  await incidentsTab.click();
  await expect(live).toContainText('Besoin d’aide · PRIORITAIRE');
  await live.getByRole('button', { name: 'Je m’en occupe' }).click();
  const field = member.getByTestId('vue-terrain');
  await field.getByRole('tab', { name: /Incidents/ }).click();
  await expect(field.getByTestId('incidents')).toContainText('Pris en charge par Admin E2E');

  // Carte et retour à la planification.
  await live.getByRole('tab', { name: /Carte/ }).click();
  await expect(live.getByTestId('carte-direct')).toBeVisible();
  await live.getByRole('link', { name: '🗺 Planification' }).click();
  await expect(phone.getByRole('tab', { name: /Équipes/ })).toBeVisible();
  await phoneCtx.close();
  await memberCtx.close();
});

test('l’administrateur crée un lien de connexion pour un compte', async ({ page, browser }) => {
  await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin-e2e-motdepasse' }, headers: H });
  await page.request.post('/api/admin/users', { data: { login: 'lien.e2e', displayName: 'Lien E2E', password: 'mot-de-passe-lien-e2e', globalRole: 'organisateur' }, headers: H });
  await page.goto('/#/admin');
  await page.locator('tr', { hasText: 'lien.e2e' }).getByRole('button', { name: 'Lien de connexion' }).click();
  const url = await page.getByTestId('lien-admin').getByLabel('Lien de connexion').inputValue();
  expect(url).toMatch(/\/connexion\/[\w-]{40,}$/);
  const ctx = await browser.newContext(PHONE);
  const p = await ctx.newPage();
  await p.goto(new URL(url).pathname);
  await p.getByRole('button', { name: 'Se connecter' }).click();
  await expect(p.getByText('Lien E2E')).toBeVisible();
  await ctx.close();
});
