// Comptes membres : création par un administrateur, activation par lien, équipes, profil, gestion par l'organisation,
// expiration et suppression automatique.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { purgeExpiredAccounts } from '../src/services/expiry.js';
import { Agent, createMember, createUser, memberAgent, setup, type TestContext } from './helpers/app.js';
import { at } from './helpers/osm.js';

let ctx: TestContext;
let admin: Agent;
let orga: Agent;
let eventId: number;
let teamA: number;
let teamB: number;

beforeAll(async () => {
  ctx = await setup();
  await createUser(ctx.db, 'admin', 'admin');
  await createUser(ctx.db, 'orga', 'organisateur');
  admin = new Agent(ctx.app);
  await admin.login('admin');
  orga = new Agent(ctx.app);
  await orga.login('orga');
  eventId = (await orga.post('/api/events', { name: 'Comptes membres', instructions: 'Gilets.' })).json().id;
  teamA = (await orga.post('/api/events/' + eventId + '/teams', { name: 'A', color: '#e63946' })).json().id;
  teamB = (await orga.post('/api/events/' + eventId + '/teams', { name: 'B', color: '#1d3557' })).json().id;
  const p = (await orga.post('/api/events/' + eventId + '/points', { name: 'Angle', position: at(0, 0) })).json().id;
  await orga.post('/api/teams/' + teamA + '/missions', { pointId: p });
});
afterAll(() => ctx.close());

describe('création des comptes par un administrateur', () => {
  it('membre : prénom, nom, e-mail, expiration ; lien d’activation à transmettre ; pas de mot de passe', async () => {
    const expires = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const r = await admin.post('/api/admin/users', { globalRole: 'membre', firstName: 'Camille', lastName: 'Martin', email: 'camille@exemple.org', expiresAt: expires });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ displayName: 'Camille Martin', globalRole: 'membre', login: null, email: 'camille@exemple.org' });
    expect(new Date(r.json().expiresAt).toISOString()).toBe(expires);
    expect(r.json().activation.url).toMatch(/^https:\/\/cortege\.test\/connexion\//);

    // Activation : le membre se connecte par le lien, pour plusieurs jours.
    const m = new Agent(ctx.app);
    const login = await m.linkLogin(r.json().activation.path);
    expect(login.statusCode).toBe(200);
    expect(Number(/Max-Age=(\d+)/.exec(String(login.headers['set-cookie']))![1])).toBeGreaterThan(5 * 86_400);
    expect((await m.get('/api/auth/me')).json()).toMatchObject({ displayName: 'Camille Martin', globalRole: 'membre' });
    // Il ne voit ni les manifestations ni leur organisation.
    expect((await m.get('/api/events')).json()).toEqual([]);
    expect((await m.get('/api/events/' + eventId)).statusCode).toBe(404);
    expect((await m.get('/api/moi/equipes')).json()).toEqual([]);
    // Pas de connexion par mot de passe.
    expect((await new Agent(ctx.app).login('camille', 'x')).statusCode).toBe(401);
  });

  it('compte d’organisation : identifiant et mot de passe obligatoires ; un nom est requis', async () => {
    expect((await admin.post('/api/admin/users', { globalRole: 'organisateur', firstName: 'Léa' })).statusCode).toBe(400);
    expect((await admin.post('/api/admin/users', { globalRole: 'membre' })).statusCode).toBe(400);
    const r = await admin.post('/api/admin/users', { globalRole: 'organisateur', firstName: 'Léa', lastName: 'Dupont', login: 'lea', password: 'mot-de-passe-solide' });
    expect(r.json()).toMatchObject({ displayName: 'Léa Dupont', activation: null });
    expect((await orga.post('/api/admin/users', { globalRole: 'membre', firstName: 'X' })).statusCode).toBe(403);
  });

  it('les anciennes invitations d’équipe n’existent plus', async () => {
    expect((await new Agent(ctx.app).get('/api/rejoindre/abc')).statusCode).toBe(404);
    expect((await orga.post('/api/teams/' + teamA + '/invitations', { kind: 'equipe' })).statusCode).toBe(404);
  });
});

describe('équipes et profil du membre', () => {
  it('ajouté par l’organisation, il voit son équipe et sa vue terrain, pas les autres', async () => {
    const id = await createMember(ctx.db, 'Yann');
    expect((await orga.get('/api/teams/' + teamA + '/candidats?q=yan')).json().map((c: { id: number }) => c.id)).toContain(id);
    expect((await orga.post('/api/teams/' + teamA + '/members', { userId: id })).statusCode).toBe(200);
    const m = await memberAgent(ctx, orga, teamB, 'Zoé');
    const mine = (await m.get('/api/moi/equipes')).json();
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: teamB, name: 'B', role: 'membre', event: { name: 'Comptes membres' } });
    expect((await m.get('/api/terrain/equipes/' + teamB)).statusCode).toBe(200);
    expect((await m.get('/api/terrain/equipes/' + teamA)).statusCode).toBe(404);
    // Retiré : accès coupé à l'équipe.
    await orga.request('DELETE', '/api/teams/' + teamB + '/members/' + m.userId);
    expect((await m.get('/api/terrain/equipes/' + teamB)).statusCode).toBe(404);
    expect((await m.get('/api/moi/equipes')).json()).toEqual([]);
  });

  it('profil : prénom, nom, e-mail (unique)', async () => {
    const m = await memberAgent(ctx, orga, teamA, 'Ines');
    const r = await m.patch('/api/moi/profil', { firstName: 'Inès', lastName: 'Garcia', email: 'Ines@Exemple.org' });
    expect(r.json()).toMatchObject({ displayName: 'Inès Garcia', email: 'ines@exemple.org' });
    expect((await m.get('/api/moi/profil')).json()).toMatchObject({ firstName: 'Inès', lastName: 'Garcia', email: 'ines@exemple.org' });
    expect((await m.get('/api/terrain/equipes/' + teamA)).json().me.displayName).toBe('Inès Garcia');
    expect((await m.patch('/api/moi/profil', { firstName: 'X', lastName: '', email: 'camille@exemple.org' })).statusCode).toBe(409);
    // Le lien par e-mail fonctionne avec cette adresse.
    await new Agent(ctx.app).post('/api/auth/lien-email', { email: 'ines@exemple.org' });
    expect(ctx.mails.at(-1)!.to).toBe('ines@exemple.org');
  });
});

describe('gestion des membres par l’organisation et les responsables', () => {
  it('un responsable gère les membres seulement si l’organisation le permet, sans nommer de responsable', async () => {
    const chef = await memberAgent(ctx, orga, teamB, 'Chef');
    await orga.post('/api/teams/' + teamB + '/members', { userId: chef.userId, role: 'responsable' });
    const nouveau = await createMember(ctx.db, 'Nouveau');
    expect((await chef.post('/api/teams/' + teamB + '/members', { userId: nouveau })).statusCode).toBe(403);
    const team = (await orga.get('/api/events/' + eventId + '/teams')).json().find((t: { id: number }) => t.id === teamB);
    await orga.patch('/api/teams/' + teamB, { leaderCanManage: true, version: team.version });
    expect((await chef.post('/api/teams/' + teamB + '/members', { userId: nouveau })).statusCode).toBe(200);
    expect((await chef.post('/api/teams/' + teamB + '/members', { userId: nouveau, role: 'responsable' })).statusCode).toBe(403);
    // Lien de connexion pour un membre de l'équipe (téléphone perdu).
    const l = await chef.post('/api/teams/' + teamB + '/members/' + nouveau + '/lien');
    expect(l.statusCode).toBe(201);
    expect((await new Agent(ctx.app).linkLogin(l.json().path)).statusCode).toBe(200);
  });

  it('un compte d’organisation ajouté à une équipe doit avoir accès à la manifestation', async () => {
    const id = await createUser(ctx.db, 'sans.acces', 'organisateur');
    expect((await orga.post('/api/teams/' + teamA + '/members', { userId: id })).statusCode).toBe(400);
    await orga.put('/api/events/' + eventId + '/members', { userId: id, role: 'membre' });
    expect((await orga.post('/api/teams/' + teamA + '/members', { userId: id })).statusCode).toBe(200);
    // Pas de lien de connexion d'équipe pour un compte d'organisation.
    expect((await orga.post('/api/teams/' + teamA + '/members/' + id + '/lien')).statusCode).toBe(403);
    // Un compte « membre » ne peut pas recevoir d'accès à l'organisation d'une manifestation.
    const membre = await createMember(ctx.db, 'Pas orga');
    expect((await orga.put('/api/events/' + eventId + '/members', { userId: membre, role: 'membre' })).statusCode).toBe(404);
  });
});

describe('expiration', () => {
  it('compte expiré : plus de session ni de lien, puis suppression automatique (journalisée)', async () => {
    const m = await memberAgent(ctx, orga, teamA, 'Éphémère');
    await ctx.db.query("UPDATE users SET expires_at = now() - interval '1 minute' WHERE id = $1", [m.userId]);
    expect((await m.get('/api/auth/me')).statusCode).toBe(401);
    expect((await admin.post('/api/admin/users/' + m.userId + '/lien')).statusCode).toBe(409);
    expect(await purgeExpiredAccounts(ctx.app)).toBe(1);
    expect((await ctx.db.query('SELECT count(*)::int AS n FROM users WHERE id = $1', [m.userId])).rows[0].n).toBe(0);
    expect((await ctx.db.query("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'suppression_automatique' AND entity_id = $1", [m.userId])).rows[0].n).toBe(1);
  });

  it('modifiable par l’administrateur, jamais sur son propre compte ; suppression immédiate possible', async () => {
    const me = (await admin.get('/api/auth/me')).json();
    expect((await admin.patch('/api/admin/users/' + me.id, { expiresAt: new Date(Date.now() + 86_400_000).toISOString() })).statusCode).toBe(409);
    const id = await createMember(ctx.db, 'À supprimer');
    const r = await admin.patch('/api/admin/users/' + id, { expiresAt: null, firstName: 'Bientôt', lastName: 'Supprimé' });
    expect(r.json()).toMatchObject({ expiresAt: null, displayName: 'Bientôt Supprimé' });
    expect((await admin.request('DELETE', '/api/admin/users/' + id)).statusCode).toBe(200);
    expect((await admin.request('DELETE', '/api/admin/users/' + me.id)).statusCode).toBe(409);
  });
});
