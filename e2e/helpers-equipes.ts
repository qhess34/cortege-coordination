// Onglet Équipes : déplie une équipe (si elle est repliée) et ouvre l'une de ses sections.
import type { Page } from '@playwright/test';

export async function openTeam(page: Page, name: string, section?: 'Points' | 'Membres' | 'Réglages') {
  const card = page.locator('section.team', { has: page.locator('.team-head', { hasText: name }) });
  const head = card.locator('.team-head');
  await head.waitFor();
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
  if (section) await card.getByRole('tab', { name: new RegExp('^' + section) }).click();
  return card;
}
