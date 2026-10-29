// Membres d'équipe : compte créé par l'administrateur, ajouté à l'équipe, connecté par son lien d'activation.
import type { Page } from '@playwright/test';

const H = { 'x-requested-with': 'cortege' };

/** Crée un compte membre (la page doit être connectée en administrateur), l'ajoute à l'équipe, renvoie son lien. */
export async function invite(page: Page, teamId: number, firstName: string): Promise<{ path: string; userId: number }> {
  const u = await (await page.request.post('/api/admin/users', { data: { globalRole: 'membre', firstName }, headers: H })).json();
  await page.request.post('/api/teams/' + teamId + '/members', { data: { userId: u.id }, headers: H });
  return { path: u.activation.path, userId: u.id };
}

/** Le membre ouvre son lien sur son téléphone et se connecte ; avec une seule équipe, la vue terrain s'ouvre. */
export async function signIn(p: Page, path: string): Promise<void> {
  await p.goto(path);
  await p.getByRole('button', { name: 'Se connecter' }).click();
  await p.getByTestId('vue-terrain').waitFor();
}
