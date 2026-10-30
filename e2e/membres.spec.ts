// Comptes membres : création par l'administrateur, activation par lien, ajout à une équipe, profil, lien de connexion,
// retrait ; un organisateur membre d'une équipe garde l'onglet « Mon équipe ».
import { expect, test } from '@playwright/test';
import { openTeam } from './helpers-equipes';

const H = { 'x-requested-with': 'cortege' };
const PHONE = { viewport: { width: 390, height: 844 }, locale: 'fr-FR', serviceWorkers: 'block' as const };

test('compte membre : création, activation, équipe, profil, lien de connexion, retrait', async ({ page, browser }) => {
  await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin-e2e-motdepasse' }, headers: H });
  const ev = await (await page.request.post('/api/events', { data: { name: 'Comptes membres', instructions: 'Gilet orange.' }, headers: H })).json();
  await page.request.post('/api/events/' + ev.id + '/teams', { data: { name: 'Équipe Nord', color: '#2a9d8f' }, headers: H });

  // 1. L'administrateur crée le compte (membre, avec expiration) et obtient le lien d'activation.
  await page.goto('/#/admin');
  const form = page.getByTestId('nouveau-compte');
  await form.getByLabel('Membre d’équipe').check();
  await form.getByLabel('Prénom').fill('Camille');
  await form.getByLabel('Nom', { exact: true }).fill('Martin');
  await form.getByLabel(/^Expiration/).fill('2099-12-31T18:00');
  await expect(form.getByLabel('Identifiant')).toHaveCount(0);
  await form.getByRole('button', { name: 'Créer le compte et obtenir le lien d’activation' }).click();
  const activation = await page.getByTestId('lien-admin').getByLabel('Lien de connexion').inputValue();
  expect(activation).toMatch(/\/connexion\/[\w-]{40,}$/);
  await expect(page.locator('tr', { hasText: 'Camille Martin' })).toContainText('par lien');
  await expect(page.locator('tr', { hasText: 'Camille Martin' })).toContainText('31/12/2099');

  // 2. L'organisation l'ajoute à une équipe.
  await page.goto('/#/evenements/' + ev.id);
  await page.getByRole('tab', { name: /Équipes/ }).click();
  const card = await openTeam(page, 'Équipe Nord', 'Membres');
  await card.getByLabel('Rechercher un compte à ajouter').fill('Camille');
  await card.locator('li', { hasText: 'Camille Martin' }).getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.getByText('Camille Martin a rejoint l’équipe.')).toBeVisible();
  // Nommée responsable, puis redevenue simple membre.
  const row = card.locator('li', { hasText: 'Camille Martin' });
  await row.getByRole('button', { name: 'Nommer responsable' }).click();
  await expect(row).toContainText('(responsable)');
  await row.getByRole('button', { name: 'Retirer « responsable »' }).click();
  await expect(row).not.toContainText('(responsable)');

  // 3. Le membre active son compte sur son téléphone : sa vue terrain s'ouvre directement.
  const phoneCtx = await browser.newContext(PHONE);
  const phone = await phoneCtx.newPage();
  await phone.goto(new URL(activation).pathname);
  await expect(phone.getByTestId('lien-connexion')).toContainText('Camille Martin');
  await phone.getByRole('button', { name: 'Se connecter' }).click();
  const field = phone.getByTestId('vue-terrain');
  await expect(field.locator('h1')).toContainText('Équipe Nord');
  // Il ne voit rien de la planification.
  expect((await phone.request.get('/api/events/' + ev.id)).status()).toBe(404);

  // 4. Profil : nom, e-mail et téléphone.
  await field.getByRole('link', { name: 'Profil' }).click();
  const profil = phone.getByTestId('profil');
  await profil.getByLabel('Nom', { exact: true }).fill('Martin-Durand');
  await profil.getByLabel('Adresse e-mail').fill('camille@exemple.org');
  await profil.getByLabel('Téléphone').fill('06 12 34 56 78');
  await profil.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(profil).toContainText('Profil enregistré.');
  await expect(profil).toContainText('supprimé automatiquement');
  await phone.getByRole('link', { name: '← Retour' }).click();
  await expect(phone.getByTestId('vue-terrain').getByText('Camille Martin-Durand')).toBeVisible();

  // 5. Téléphone perdu : l'organisation lui renvoie un lien de connexion.
  await page.reload();
  await page.getByRole('tab', { name: /Équipes/ }).click();
  const card2 = await openTeam(page, 'Équipe Nord', 'Membres');
  // Le numéro saisi dans le profil est cliquable pour l'organisation.
  await expect(card2.locator('li', { hasText: 'Camille Martin-Durand' }).getByRole('link', { name: 'Appeler Camille Martin-Durand' })).toHaveAttribute('href', 'tel:0612345678');
  await card2.locator('li', { hasText: 'Camille Martin-Durand' }).getByRole('button', { name: 'Lien de connexion' }).click();
  const relink = await card2.getByLabel('Lien de connexion du membre').inputValue();
  const other = await (await browser.newContext(PHONE)).newPage();
  await other.goto(new URL(relink).pathname);
  await other.getByRole('button', { name: 'Se connecter' }).click();
  await expect(other.getByTestId('vue-terrain')).toBeVisible();

  // 6. Retiré de l'équipe : il ne la voit plus.
  page.once('dialog', (d) => void d.accept());
  await card2.locator('li', { hasText: 'Camille Martin-Durand' }).getByRole('button', { name: 'Retirer' }).click();
  await other.reload();
  await expect(other.getByTestId('mes-equipes')).toContainText('membre d’aucune équipe');
  await phoneCtx.close();
});

test('un organisateur membre d’une équipe a aussi l’onglet « Mon équipe »', async ({ page }) => {
  await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin-e2e-motdepasse' }, headers: H });
  const ev = await (await page.request.post('/api/events', { data: { name: 'Orga et membre', instructions: 'Gilet jaune.' }, headers: H })).json();
  await page.request.post('/api/events/' + ev.id + '/teams', { data: { name: 'Équipe Est', color: '#3a86ff' }, headers: H });
  await page.goto('/#/evenements/' + ev.id);
  await expect(page.getByRole('tab', { name: 'Mon équipe' })).toHaveCount(0);
  await page.getByRole('tab', { name: /Équipes/ }).click();
  const card = await openTeam(page, 'Équipe Est', 'Membres');
  await card.getByLabel('Rechercher un compte à ajouter').fill('Admin');
  await card.locator('li', { hasText: 'Admin E2E' }).getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.getByText('Admin E2E a rejoint l’équipe.')).toBeVisible();
  await page.getByRole('tab', { name: 'Mon équipe' }).click();
  await expect(page.getByTestId('mon-equipe')).toContainText('Équipe Est');
  await expect(page.getByTestId('mon-equipe')).toContainText('Gilet jaune.');
  await page.getByRole('tab', { name: /Synthèse/ }).click();
  await expect(page.getByTestId('acces-manifestation')).toBeVisible();
});

test('l’administrateur crée un compte d’organisation', async ({ page }) => {
  await page.request.post('/api/auth/login', { data: { login: 'admin', password: 'admin-e2e-motdepasse' }, headers: H });
  await page.goto('/#/admin');
  const form = page.getByTestId('nouveau-compte');
  await form.getByLabel('Organisateur').check();
  await form.getByLabel('Prénom').fill('Orga');
  await form.getByLabel('Nom', { exact: true }).fill('E2E');
  await form.getByLabel('Identifiant').fill('orga.e2e');
  await form.getByLabel('Mot de passe initial').fill('mot-de-passe-orga-e2e');
  await form.getByRole('button', { name: 'Créer le compte' }).click();
  await expect(page.locator('tr', { hasText: 'Orga E2E' })).toContainText('identifiant « orga.e2e »');
});
