import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent, createUser, setup, type TestContext } from './helpers/app.js';

let ctx: TestContext;
let admin: Agent;
let orga: Agent;
let other: Agent;
let eventId: number;

beforeAll(async () => {
  ctx = await setup();
  await createUser(ctx.db, 'admin', 'admin');
  await createUser(ctx.db, 'orga', 'organisateur');
  await createUser(ctx.db, 'autre', 'organisateur');
  admin = new Agent(ctx.app);
  orga = new Agent(ctx.app);
  other = new Agent(ctx.app);
  expect((await admin.login('admin')).statusCode).toBe(200);
  expect((await orga.login('orga')).statusCode).toBe(200);
  expect((await other.login('autre')).statusCode).toBe(200);
  const ev = await orga.post('/api/events', { name: 'Marche du 1er mai' });
  eventId = ev.json().id;
});
afterAll(() => ctx.close());

describe('comptes administrés', () => {
  it("n'offre aucune inscription publique", async () => {
    const anon = new Agent(ctx.app);
    for (const url of ['/api/auth/register', '/api/auth/signup', '/api/users']) {
      expect((await anon.post(url, { login: 'x', password: 'y' })).statusCode).toBe(404);
    }
    expect((await anon.post('/api/admin/users', { login: 'pirate', displayName: 'P', password: 'aaaaaaaaaaaa' })).statusCode).toBe(401);
  });

  it('réserve la création de comptes aux administrateurs', async () => {
    const body = { login: 'nouveau', displayName: 'Nouveau', password: 'un-mot-de-passe-long' };
    expect((await orga.post('/api/admin/users', body)).statusCode).toBe(403);
    const r = await admin.post('/api/admin/users', body);
    expect(r.statusCode).toBe(201);
    expect(r.json()).not.toHaveProperty('password_hash');
    expect((await admin.post('/api/admin/users', body)).statusCode).toBe(409);
  });

  it("un organisateur ne peut pas modifier les rôles globaux", async () => {
    const users = (await admin.get('/api/admin/users')).json() as { id: number; login: string }[];
    const me = users.find((u) => u.login === 'orga')!;
    expect((await orga.patch('/api/admin/users/' + me.id, { globalRole: 'admin' })).statusCode).toBe(403);
    expect((await orga.get('/api/admin/users')).statusCode).toBe(403);
  });

  it('refuse un mauvais mot de passe puis bloque après plusieurs échecs', async () => {
    const a = new Agent(ctx.app);
    expect((await a.login('autre', 'mauvais')).statusCode).toBe(401);
    for (let i = 0; i < 5; i++) await a.login('nouveau', 'mauvais');
    expect((await a.login('nouveau', 'un-mot-de-passe-long')).statusCode).toBe(429);
  });

  it('ne stocke que le hash du jeton de session, en cookie HttpOnly', async () => {
    const a = new Agent(ctx.app);
    const res = await a.login('orga');
    const set = String(res.headers['set-cookie']);
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/SameSite=Lax/i);
    const token = a.cookie!.split('=')[1]!;
    const rows = (await ctx.db.query('SELECT token_hash FROM sessions')).rows;
    expect(rows.some((r) => Buffer.from(r.token_hash).toString('utf8').includes(token))).toBe(false);
  });

  it('réutilise la session puis la révoque à la déconnexion', async () => {
    const a = new Agent(ctx.app);
    await a.login('orga');
    expect((await a.get('/api/auth/me')).json().login).toBe('orga');
    const cookie = a.cookie;
    await a.post('/api/auth/logout');
    a.cookie = cookie; // le jeton volé ne sert plus à rien
    expect((await a.get('/api/auth/me')).statusCode).toBe(401);
  });

  it('désactiver un compte révoque immédiatement ses sessions', async () => {
    const id = await createUser(ctx.db, 'temporaire', 'organisateur');
    const a = new Agent(ctx.app);
    await a.login('temporaire');
    expect((await a.get('/api/auth/me')).statusCode).toBe(200);
    expect((await admin.patch('/api/admin/users/' + id, { disabled: true })).statusCode).toBe(200);
    expect((await a.get('/api/auth/me')).statusCode).toBe(401);
    expect((await a.post('/api/events', { name: 'x' })).statusCode).toBe(401);
    expect((await a.login('temporaire')).statusCode).toBe(401);
  });

  it('exige l\'en-tête anti-CSRF sur les requêtes modifiantes', async () => {
    const r = await orga.request('POST', '/api/events', { name: 'x' }, { 'x-requested-with': '' });
    expect(r.statusCode).toBe(403);
  });
});

describe('isolation des événements', () => {
  it("un organisateur ne voit pas les événements d'autrui", async () => {
    expect((await other.get('/api/events')).json()).toEqual([]);
    expect((await other.get('/api/events/' + eventId)).statusCode).toBe(404);
    expect((await other.get('/api/events/' + eventId + '/points')).statusCode).toBe(404);
    expect((await other.post('/api/events/' + eventId + '/teams', { name: 'Intrus', color: '#ff0000' })).statusCode).toBe(404);
    expect((await admin.get('/api/events/' + eventId)).statusCode).toBe(200);
  });

  it("n'accorde pas de droits par modification d'identifiant dans l'URL", async () => {
    const p = await orga.post('/api/events/' + eventId + '/points', { name: 'Point A', position: [2.35, 48.85] });
    expect(p.statusCode).toBe(201);
    const id = p.json().id;
    expect((await other.get('/api/points/' + id)).statusCode).toBe(404);
    expect((await other.patch('/api/points/' + id, { name: 'Piraté', version: 1 })).statusCode).toBe(404);
    expect((await other.delete('/api/points/' + id)).statusCode).toBe(404);
    expect((await other.get('/api/points/abc')).statusCode).toBe(404);
  });

  it('un simple membre de l\'événement lit mais ne modifie pas', async () => {
    const id = await createUser(ctx.db, 'membre', 'aucun');
    expect((await orga.put('/api/events/' + eventId + '/members', { userId: id, role: 'membre' })).statusCode).toBe(200);
    const m = new Agent(ctx.app);
    await m.login('membre');
    expect((await m.get('/api/events/' + eventId)).json().role).toBe('membre');
    expect((await m.post('/api/events/' + eventId + '/points', { name: 'X', position: [2.35, 48.85] })).statusCode).toBe(403);
    expect((await m.patch('/api/events/' + eventId, { name: 'X', version: 1 })).statusCode).toBe(403);
    expect((await m.post('/api/events', { name: 'Le mien' })).statusCode).toBe(403);
    expect((await m.get('/api/events/' + eventId + '/history')).statusCode).toBe(403);
  });
});

describe('en-têtes de sécurité', () => {
  it("envoie l'origine du site aux serveurs de tuiles, mais rien depuis une page de lien de connexion", async () => {
    const page = await ctx.app.inject({ method: 'GET', url: '/' });
    expect(page.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    const lien = await ctx.app.inject({ method: 'GET', url: '/connexion/jeton-secret' });
    expect(lien.headers['referrer-policy']).toBe('no-referrer');
  });
});
