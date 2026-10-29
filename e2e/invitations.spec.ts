// Lot 2 : comptes, QR code d'équipe, validation des demandes, lien individuel à usage unique.
import { expect, test } from '@playwright/test';

const H = { 'x-requested-with': 'cortege' };

test('l’administrateur crée un compte depuis l’écran Comptes', async ({ page }) => {
  await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin-e2e-motdepasse' }, headers: H });
  await page.goto('/#/admin');
  await page.getByLabel('Identifiant').fill('orga.e2e');
  await page.getByLabel('Nom affiché').fill('Orga E2E');
  await page.getByLabel('Mot de passe initial').fill('mot-de-passe-orga-e2e');
  await page.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page.locator('table')).toContainText('orga.e2e');
});

test('QR code avec validation : le participant attend, le responsable accepte, il voit son équipe', async ({ page, browser }) => {
  await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin-e2e-motdepasse' }, headers: H });
  const ev = await (await page.request.post('/api/events', { data: { name: 'Invitations QR' }, headers: H })).json();
  await page.request.post('/api/events/' + ev.id + '/teams', { data: { name: 'Équipe Nord', color: '#2a9d8f' }, headers: H });
  await page.goto('/#/evenements/' + ev.id);
  await page.getByRole('tab', { name: /Équipes/ }).click();
  await page.getByRole('button', { name: /Membres et invitations/ }).click();
  await page.getByRole('button', { name: 'Créer le QR code' }).click();
  await expect(page.getByTestId('qr-code')).toBeVisible();
  const url = await page.getByLabel('Lien du QR code').inputValue();
  expect(url).toMatch(/\/rejoindre\/[A-Za-z0-9_-]{20,}$/);

  // Le participant, sur un autre appareil, sans compte.
  const phone = await browser.newContext({ viewport: { width: 390, height: 800 }, locale: 'fr-FR' });
  const p = await phone.newPage();
  await p.goto(url);
  await expect(p.getByTestId('rejoindre')).toContainText('Équipe Nord');
  await p.getByLabel('Votre nom ou pseudonyme').fill('Camille');
  await p.getByRole('button', { name: 'Rejoindre l’équipe' }).click();
  await expect(p.getByTestId('espace-participant')).toContainText('attend la validation');
  expect(new URL(p.url()).pathname).toBe('/');

  // L'organisateur accepte la demande.
  await page.reload();
  await page.getByRole('tab', { name: /Équipes/ }).click();
  await page.getByRole('button', { name: /Membres et invitations/ }).click();
  await page.getByRole('button', { name: 'Accepter' }).click();
  await expect(page.getByText('Camille a rejoint l’équipe.')).toBeVisible();

  await p.getByRole('button', { name: 'Actualiser' }).click();
  await expect(p.getByTestId('espace-participant').locator('h1')).toContainText('Équipe Nord');
  // Le participant n'a aucun accès à l'organisation de la manifestation.
  expect((await p.request.get('/api/events/' + ev.id)).status()).toBe(404);
  await phone.close();
});

test('lien individuel : affiché une seule fois, utilisable une seule fois', async ({ page, browser }) => {
  await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin-e2e-motdepasse' }, headers: H });
  const ev = await (await page.request.post('/api/events', { data: { name: 'Invitations lien' }, headers: H })).json();
  await page.request.post('/api/events/' + ev.id + '/teams', { data: { name: 'Équipe Sud', color: '#e63946' }, headers: H });
  await page.goto('/#/evenements/' + ev.id);
  await page.getByRole('tab', { name: /Équipes/ }).click();
  await page.getByRole('button', { name: /Membres et invitations/ }).click();
  await page.getByPlaceholder('Pour qui ? (facultatif)').fill('Dominique');
  await page.getByRole('button', { name: 'Créer un lien' }).click();
  const url = await page.getByLabel('Lien d’invitation').inputValue();

  const phone = await browser.newContext({ locale: 'fr-FR' });
  const p = await phone.newPage();
  await p.goto(url);
  await p.getByLabel('Votre nom ou pseudonyme').fill('Dominique');
  await p.getByRole('button', { name: 'Rejoindre l’équipe' }).click();
  await expect(p.getByTestId('espace-participant').locator('h1')).toContainText('Équipe Sud');

  // Second appareil : le lien est déjà utilisé.
  const other = await browser.newContext({ locale: 'fr-FR' });
  const o = await other.newPage();
  await o.goto(url);
  await expect(o.getByTestId('rejoindre')).toContainText('déjà été utilisé');
  await expect(o.getByRole('button', { name: 'Rejoindre l’équipe' })).toHaveCount(0);

  // Le membre apparaît côté organisation.
  await page.reload();
  await page.getByRole('tab', { name: /Équipes/ }).click();
  await page.getByRole('button', { name: /Membres et invitations/ }).click();
  await expect(page.getByTestId(/acces-equipe-/)).toContainText('Dominique');
  await phone.close();
  await other.close();
});

test('un organisateur membre d’une équipe a aussi l’onglet « Mon équipe »', async ({ page }) => {
  await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin-e2e-motdepasse' }, headers: H });
  const ev = await (await page.request.post('/api/events', { data: { name: 'Orga et membre', instructions: 'Gilet jaune.' }, headers: H })).json();
  await page.request.post('/api/events/' + ev.id + '/teams', { data: { name: 'Équipe Est', color: '#3a86ff' }, headers: H });
  await page.goto('/#/evenements/' + ev.id);
  await expect(page.getByRole('tab', { name: 'Mon équipe' })).toHaveCount(0);
  await page.getByRole('tab', { name: /Équipes/ }).click();
  await page.getByRole('button', { name: /Membres et invitations/ }).click();
  await page.getByLabel('Compte à ajouter').selectOption({ label: 'Admin E2E' });
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.getByText('Compte ajouté à l’équipe.')).toBeVisible();
  await page.getByRole('tab', { name: 'Mon équipe' }).click();
  await expect(page.getByTestId('mon-equipe')).toContainText('Équipe Est');
  await expect(page.getByTestId('mon-equipe')).toContainText('Gilet jaune.');
  // L'organisation reste accessible.
  await page.getByRole('tab', { name: /Synthèse/ }).click();
  await expect(page.getByTestId('acces-manifestation')).toBeVisible();
});

test('depuis l’espace participant, on peut revenir à la connexion d’un compte', async ({ page }) => {
  await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin-e2e-motdepasse' }, headers: H });
  const ev = await (await page.request.post('/api/events', { data: { name: 'Retour orga' }, headers: H })).json();
  const team = await (await page.request.post('/api/events/' + ev.id + '/teams', { data: { name: 'Équipe Ouest', color: '#8ac926' }, headers: H })).json();
  const inv = await (await page.request.post('/api/teams/' + team.id + '/invitations', { data: { kind: 'equipe', admission: 'immediate' }, headers: H })).json();
  await page.request.post('/api/auth/logout', { headers: H });
  await page.goto(inv.path);
  await page.getByLabel('Votre nom ou pseudonyme').fill('Test');
  await page.getByRole('button', { name: 'Rejoindre l’équipe' }).click();
  await expect(page.getByTestId('espace-participant')).toBeVisible();
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Se connecter avec un compte d’organisation' }).click();
  await page.getByLabel('Identifiant').fill('admin');
  await page.getByLabel('Mot de passe').fill('admin-e2e-motdepasse');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.goto('/#/evenements/' + ev.id);
  await expect(page.getByRole('tab', { name: /Équipes/ })).toBeVisible();
});
