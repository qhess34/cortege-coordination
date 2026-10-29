// Connexion des comptes par lien : QR d'un appareil connecté, lien créé par un administrateur, e-mail.
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent, createUser, setup, type TestContext } from './helpers/app.js';

let ctx: TestContext;
let admin: Agent;
let orga: Agent;
let orgaId: number;
const logs: string[] = [];
const tokenOf = (path: string) => path.split('/connexion/')[1]!;

beforeAll(async () => {
  ctx = await setup({ logStream: new Writable({ write(chunk, _e, cb) { logs.push(String(chunk)); cb(); } }) });
  await createUser(ctx.db, 'admin', 'admin');
  orgaId = await createUser(ctx.db, 'orga', 'organisateur');
  admin = new Agent(ctx.app);
  await admin.login('admin');
  orga = new Agent(ctx.app);
  await orga.login('orga');
});
afterAll(() => ctx.close());

describe('connecter un autre appareil (QR code)', () => {
  it('lien à usage unique qui ouvre une session sur le nouvel appareil', async () => {
    const r = await orga.post('/api/auth/liens');
    expect(r.statusCode).toBe(201);
    expect(r.json().url).toMatch(/^https:\/\/cortege\.test\/connexion\/[\w-]{40,}$/);
    const token = tokenOf(r.json().path);
    const phone = new Agent(ctx.app);
    expect((await phone.get('/api/auth/lien/' + token)).json()).toMatchObject({ state: 'valide', displayName: 'orga' });
    // L'aperçu ne connecte pas.
    expect((await phone.get('/api/auth/me')).statusCode).toBe(401);
    const login = await phone.request('POST', '/api/auth/lien/' + token, {});
    expect(login.statusCode).toBe(200);
    phone.cookie = String(login.headers['set-cookie']).split(';')[0]!;
    expect((await phone.get('/api/auth/me')).json()).toMatchObject({ id: orgaId, globalRole: 'organisateur' });
    // Deuxième usage refusé.
    const again = await new Agent(ctx.app).request('POST', '/api/auth/lien/' + token, {});
    expect(again.statusCode).toBe(410);
    expect(again.json().error).toMatch(/déjà servi/);
    expect((await new Agent(ctx.app).get('/api/auth/lien/inconnu')).statusCode).toBe(404);
  });

  it('expire au bout de 10 minutes ; jeton jamais journalisé ni stocké en clair', async () => {
    const token = tokenOf((await orga.post('/api/auth/liens')).json().path);
    await new Agent(ctx.app).get('/api/auth/lien/' + token);
    expect(logs.join('\n')).not.toContain(token);
    const stored = (await ctx.db.query('SELECT token_hash FROM login_links ORDER BY id DESC LIMIT 1')).rows[0];
    expect(Buffer.from(stored.token_hash).toString('utf8')).not.toContain(token);
    await ctx.db.query("UPDATE login_links SET expires_at = now() - interval '1 second'");
    expect((await new Agent(ctx.app).request('POST', '/api/auth/lien/' + token, {})).statusCode).toBe(410);
  });

  it('un participant sans compte ne peut pas en créer', async () => {
    expect((await new Agent(ctx.app).post('/api/auth/liens')).statusCode).toBe(401);
  });
});

describe('lien créé par un administrateur', () => {
  it('réservé aux administrateurs ; invalidé si le compte est désactivé', async () => {
    expect((await orga.post('/api/admin/users/' + orgaId + '/lien')).statusCode).toBe(403);
    const r = await admin.post('/api/admin/users/' + orgaId + '/lien');
    expect(r.statusCode).toBe(201);
    const token = tokenOf(r.json().path);
    await admin.patch('/api/admin/users/' + orgaId, { disabled: true });
    expect((await new Agent(ctx.app).request('POST', '/api/auth/lien/' + token, {})).statusCode).toBe(410);
    expect((await admin.post('/api/admin/users/' + orgaId + '/lien')).statusCode).toBe(409);
    await admin.patch('/api/admin/users/' + orgaId, { disabled: false });
    expect((await new Agent(ctx.app).request('POST', '/api/auth/lien/' + token, {})).statusCode).toBe(410);
  });
});

describe('lien par e-mail', () => {
  it('envoyé seulement si l’adresse correspond à un compte actif ; réponse identique sinon', async () => {
    expect((await new Agent(ctx.app).get('/api/auth/options')).json()).toEqual({ emailLinks: true });
    expect((await admin.patch('/api/admin/users/' + orgaId, { email: 'Orga@Exemple.org' })).json().email).toBe('orga@exemple.org');
    const visitor = new Agent(ctx.app);
    const unknown = await visitor.post('/api/auth/lien-email', { email: 'personne@exemple.org' });
    const known = await visitor.post('/api/auth/lien-email', { email: 'orga@exemple.org' });
    expect(unknown.json()).toEqual(known.json());
    expect(ctx.mails).toHaveLength(1);
    expect(ctx.mails[0]!.to).toBe('orga@exemple.org');
    const url = /https:\/\/cortege\.test\/connexion\/[\w-]+/.exec(ctx.mails[0]!.text)![0];
    // Pas de second envoi immédiat à la même adresse.
    await visitor.post('/api/auth/lien-email', { email: 'orga@exemple.org' });
    expect(ctx.mails).toHaveLength(1);
    expect((await new Agent(ctx.app).request('POST', '/api/auth/lien/' + tokenOf(url), {})).statusCode).toBe(200);
  });

  it('adresse unique entre comptes', async () => {
    const other = await admin.post('/api/admin/users', { login: 'autre', displayName: 'Autre', password: 'mot-de-passe-solide', email: 'orga@exemple.org' });
    expect(other.statusCode).toBe(409);
  });
});
