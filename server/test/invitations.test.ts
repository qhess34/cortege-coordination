import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent, createUser, setup, type TestContext } from './helpers/app.js';
import { at } from './helpers/osm.js';

let ctx: TestContext;
let orga: Agent;
let eventId: number;
let teamA: number;
let teamB: number;
const logs: string[] = [];

interface Inv { id: number; token: string | null; state: string; path?: string }
const invite = async (teamId: number, body: Record<string, unknown>) => {
  const r = await orga.post('/api/teams/' + teamId + '/invitations', body);
  expect(r.statusCode).toBe(201);
  return r.json() as Inv & { token: string };
};

beforeAll(async () => {
  ctx = await setup({ logStream: new Writable({ write(chunk, _e, cb) { logs.push(String(chunk)); cb(); } }) });
  await createUser(ctx.db, 'orga', 'organisateur');
  orga = new Agent(ctx.app);
  await orga.login('orga');
  eventId = (await orga.post('/api/events', { name: 'Marche invitée', instructions: 'Gilets obligatoires.' })).json().id;
  teamA = (await orga.post('/api/events/' + eventId + '/teams', { name: 'Équipe A', color: '#e63946', instructions: 'Rester groupés.' })).json().id;
  teamB = (await orga.post('/api/events/' + eventId + '/teams', { name: 'Équipe B', color: '#1d3557' })).json().id;
  const pA = (await orga.post('/api/events/' + eventId + '/points', { name: 'Angle A', position: at(0, 0) })).json().id;
  const pB = (await orga.post('/api/events/' + eventId + '/points', { name: 'Angle B', position: at(100, 0) })).json().id;
  await orga.post('/api/teams/' + teamA + '/missions', { pointId: pA });
  await orga.post('/api/teams/' + teamB + '/missions', { pointId: pB });
});
afterAll(() => ctx.close());

describe('QR code d’équipe, admission immédiate', () => {
  let qr: Inv & { token: string };
  const p = () => new Agent(ctx.app);
  let alice: Agent;

  it("présente l'événement et l'équipe sans connexion, sans rien révéler d'autre", async () => {
    qr = await invite(teamA, { kind: 'equipe', admission: 'immediate' });
    const info = (await p().get('/api/rejoindre/' + qr.token)).json();
    expect(info).toMatchObject({ event: { name: 'Marche invitée' }, team: { name: 'Équipe A' }, state: 'valide', kind: 'equipe' });
    expect(JSON.stringify(info)).not.toMatch(/Angle|Gilets/);
    expect((await p().get('/api/rejoindre/jeton-inconnu')).statusCode).toBe(404);
  });

  it('rejoint avec un pseudonyme, sans compte ni mot de passe', async () => {
    alice = p();
    expect((await alice.join(qr.token)).statusCode).toBe(400);
    const r = await alice.join(qr.token, 'Alice');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ status: 'admis', teamName: 'Équipe A' });
    expect(String(r.headers['set-cookie'])).toMatch(/HttpOnly/i);
    const moi = (await alice.get('/api/moi')).json();
    expect(moi).toMatchObject({ participant: { displayName: 'Alice' }, event: { instructions: 'Gilets obligatoires.' }, team: { name: 'Équipe A', instructions: 'Rester groupés.' } });
    expect(moi.missions.map((m: { point: { name: string } }) => m.point.name)).toEqual(['Angle A']);
  });

  it('retrouve sa session sans rescanner le QR code', async () => {
    const autreOnglet = new Agent(ctx.app);
    autreOnglet.cookie = alice.cookie;
    expect((await autreOnglet.get('/api/moi')).json().participant.displayName).toBe('Alice');
  });

  it("n'accède ni au reste de l'événement, ni à une autre équipe, ni aux actions d'organisation", async () => {
    expect((await alice.get('/api/events/' + eventId)).statusCode).toBe(404);
    expect((await alice.get('/api/events/' + eventId + '/points')).statusCode).toBe(404);
    expect((await alice.get('/api/events/' + eventId + '/teams')).statusCode).toBe(404);
    expect((await alice.get('/api/events/' + eventId + '/roadbook')).statusCode).toBe(404);
    expect((await alice.get('/api/teams/' + teamB + '/invitations')).statusCode).toBe(404);
    expect((await alice.get('/api/teams/' + teamA + '/invitations')).statusCode).toBe(403);
    expect((await alice.post('/api/teams/' + teamA + '/invitations', { kind: 'individuelle', role: 'responsable' })).statusCode).toBe(403);
    expect((await alice.post('/api/events', { name: 'La mienne' })).statusCode).toBe(403);
    expect((await alice.get('/api/admin/users')).statusCode).toBe(403);
    expect(await alice.get('/api/events').then((r) => r.json())).toEqual([]);
    // Un participant ne peut pas se connecter avec un identifiant (il n'en a pas).
    expect((await alice.post('/api/auth/login', { login: 'alice', password: 'x' })).statusCode).toBe(401);
  });

  it('suspendre, reprendre, limiter le nombre d’utilisations', async () => {
    await orga.post('/api/invitations/' + qr.id + '/suspend');
    const r = await p().join(qr.token, 'Bob');
    expect(r.statusCode).toBe(410);
    expect(r.json().error).toMatch(/suspendues/);
    await orga.post('/api/invitations/' + qr.id + '/resume');
    expect((await p().join(qr.token, 'Bob')).statusCode).toBe(200);

    const limited = await invite(teamA, { kind: 'equipe', maxUses: 1 });
    expect((await p().join(limited.token, 'Chloé')).statusCode).toBe(200);
    const full = await p().join(limited.token, 'Dan');
    expect(full.statusCode).toBe(410);
    expect(full.json().details.state).toBe('complete');
  });

  it('régénérer : l’ancien QR code ne fonctionne plus', async () => {
    await orga.post('/api/invitations/' + qr.id + '/revoke');
    const r = await p().join(qr.token, 'Eve');
    expect(r.statusCode).toBe(410);
    expect(r.json().details.state).toBe('revoquee');
    const fresh = await invite(teamA, { kind: 'equipe' });
    expect(fresh.token).not.toBe(qr.token);
    // Le QR code reste réaffichable dans la liste ; un lien individuel, jamais.
    const list = (await orga.get('/api/teams/' + teamA + '/invitations')).json() as Inv[];
    expect(list.find((i) => i.id === fresh.id)!.token).toBe(fresh.token);
  });

  it("un QR code ne donne que le rôle de membre", async () => {
    expect((await orga.post('/api/teams/' + teamA + '/invitations', { kind: 'equipe', role: 'responsable' })).statusCode).toBe(400);
  });
});

describe('admission après validation', () => {
  it('la personne attend, puis accède à son équipe une fois acceptée', async () => {
    const inv = await invite(teamB, { kind: 'equipe', admission: 'validation' });
    const frank = new Agent(ctx.app);
    expect((await frank.join(inv.token, 'Frank')).json().status).toBe('en_attente');
    const moi = (await frank.get('/api/moi')).json();
    expect(moi).toMatchObject({ team: null, pendingTeam: 'Équipe B', missions: [] });
    const pending = (await orga.get('/api/teams/' + teamB + '/admissions')).json();
    expect(pending.map((x: { displayName: string }) => x.displayName)).toEqual(['Frank']);
    await orga.post('/api/admissions/' + pending[0].id + '/decide', { accept: true });
    expect((await frank.get('/api/moi')).json().team.name).toBe('Équipe B');
    expect((await orga.post('/api/admissions/' + pending[0].id + '/decide', { accept: true })).statusCode).toBe(409);
  });

  it('un refus coupe la session de la personne', async () => {
    const inv = await invite(teamB, { kind: 'equipe', admission: 'validation' });
    const gina = new Agent(ctx.app);
    await gina.join(inv.token, 'Gina');
    const req = ((await orga.get('/api/teams/' + teamB + '/admissions')).json() as { id: number; displayName: string }[]).find((x) => x.displayName === 'Gina')!;
    await orga.post('/api/admissions/' + req.id + '/decide', { accept: false });
    expect((await gina.get('/api/moi')).statusCode).toBe(401);
  });
});

describe('lien individuel (magic link)', () => {
  it('usage unique, jeton jamais réaffiché', async () => {
    const link = await invite(teamA, { kind: 'individuelle', label: 'Pour Hugo' });
    expect(link.path).toBe('/rejoindre/' + link.token);
    const list = (await orga.get('/api/teams/' + teamA + '/invitations')).json() as Inv[];
    expect(list.find((i) => i.id === link.id)!.token).toBeNull();
    const hugo = new Agent(ctx.app);
    expect((await hugo.join(link.token, 'Hugo')).statusCode).toBe(200);
    const again = await new Agent(ctx.app).join(link.token, 'Intrus');
    expect(again.statusCode).toBe(410);
    expect(again.json().details.state).toBe('utilisee');
    // Les ouvertures suivantes se font par la session, pas par le lien.
    expect((await hugo.get('/api/moi')).statusCode).toBe(200);
  });

  it('expiration et révocation', async () => {
    const expired = await invite(teamA, { kind: 'individuelle', expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect((await new Agent(ctx.app).join(expired.token, 'X')).json().details.state).toBe('expiree');
    const revoked = await invite(teamA, { kind: 'individuelle' });
    await orga.post('/api/invitations/' + revoked.id + '/revoke');
    expect((await new Agent(ctx.app).join(revoked.token, 'Y')).json().details.state).toBe('revoquee');
  });

  it("responsable invité par lien : peut gérer les invitations seulement si l'organisateur le permet, et jamais au-delà de membre", async () => {
    const link = await invite(teamB, { kind: 'individuelle', role: 'responsable' });
    const ines = new Agent(ctx.app);
    await ines.join(link.token, 'Inès');
    expect((await ines.get('/api/moi')).json().team.role).toBe('responsable');
    expect((await ines.get('/api/teams/' + teamB + '/invitations')).statusCode).toBe(403);
    const team = ((await orga.get('/api/events/' + eventId + '/teams')).json() as { id: number; version: number }[]).find((t) => t.id === teamB)!;
    await orga.patch('/api/teams/' + teamB, { version: team.version, leaderCanInvite: true });
    expect((await ines.get('/api/teams/' + teamB + '/invitations')).statusCode).toBe(200);
    expect((await ines.post('/api/teams/' + teamB + '/invitations', { kind: 'equipe' })).statusCode).toBe(201);
    expect((await ines.post('/api/teams/' + teamB + '/invitations', { kind: 'individuelle', role: 'responsable' })).statusCode).toBe(403);
    expect((await ines.get('/api/teams/' + teamA + '/invitations')).statusCode).toBe(404);
  });
});

describe('membres', () => {
  it("retirer un participant coupe immédiatement son accès", async () => {
    const inv = await invite(teamA, { kind: 'equipe' });
    const jules = new Agent(ctx.app);
    await jules.join(inv.token, 'Jules');
    const members = (await orga.get('/api/teams/' + teamA + '/members')).json() as { id: number; displayName: string; accountType: string }[];
    const j = members.find((m) => m.displayName === 'Jules')!;
    expect(j.accountType).toBe('participant');
    expect((await orga.delete('/api/teams/' + teamA + '/members/' + j.id)).statusCode).toBe(200);
    expect((await jules.get('/api/moi')).statusCode).toBe(401);
  });

  it("récupération d'accès : nouveau téléphone, même participant, ancienne session révoquée", async () => {
    const inv = await invite(teamA, { kind: 'equipe' });
    const ancien = new Agent(ctx.app);
    await ancien.join(inv.token, 'Karim');
    const k = ((await orga.get('/api/teams/' + teamA + '/members')).json() as { id: number; displayName: string }[]).find((m) => m.displayName === 'Karim')!;
    const rec = (await orga.post('/api/teams/' + teamA + '/members/' + k.id + '/recovery')).json();
    const info = (await new Agent(ctx.app).get('/api/rejoindre/' + rec.token)).json();
    expect(info.recovery).toEqual({ name: 'Karim' });
    const nouveau = new Agent(ctx.app);
    expect((await nouveau.join(rec.token)).json().status).toBe('admis');
    expect((await nouveau.get('/api/moi')).json().participant).toEqual({ id: k.id, displayName: 'Karim' });
    expect((await ancien.get('/api/moi')).statusCode).toBe(401);
  });

  it('ajouter un compte administré ayant accès à la manifestation', async () => {
    const id = await createUser(ctx.db, 'benevole', 'aucun');
    expect((await orga.post('/api/teams/' + teamA + '/members', { userId: id })).statusCode).toBe(400);
    await orga.put('/api/events/' + eventId + '/members', { userId: id, role: 'membre' });
    expect((await orga.post('/api/teams/' + teamA + '/members', { userId: id, role: 'responsable' })).statusCode).toBe(200);
    const annuaire = (await orga.get('/api/annuaire?q=bene')).json();
    expect(annuaire).toEqual([{ id, login: 'benevole', displayName: 'benevole' }]);
  });
});

describe('confidentialité des jetons', () => {
  it("n'apparaissent ni dans le journal du serveur ni dans l'historique", async () => {
    const link = await invite(teamA, { kind: 'individuelle' });
    await new Agent(ctx.app).get('/api/rejoindre/' + link.token);
    await new Agent(ctx.app).join(link.token, 'Léa');
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.join('\n')).not.toContain(link.token);
    expect(logs.join('\n')).toContain('[masqué]');
    const audit = (await ctx.db.query('SELECT details::text AS d FROM audit_logs')).rows.map((r) => r.d).join('\n');
    expect(audit).not.toContain(link.token);
    const stored = (await ctx.db.query('SELECT token_hash, public_token FROM invitations WHERE id = $1', [link.id])).rows[0];
    expect(stored.public_token).toBeNull();
    expect(Buffer.from(stored.token_hash).toString('utf8')).not.toContain(link.token);
  });
});

describe('suppression de la manifestation', () => {
  it('supprime aussi les participants et leurs sessions', async () => {
    const id = (await orga.post('/api/events', { name: 'Éphémère' })).json().id;
    const t = (await orga.post('/api/events/' + id + '/teams', { name: 'T', color: '#123456' })).json().id;
    const inv = (await orga.post('/api/teams/' + t + '/invitations', { kind: 'equipe' })).json();
    const m = new Agent(ctx.app);
    await m.join(inv.token, 'Mia');
    expect((await orga.request('DELETE', '/api/events/' + id, { confirmName: 'Éphémère' })).statusCode).toBe(200);
    expect((await m.get('/api/moi')).statusCode).toBe(401);
    expect((await ctx.db.query('SELECT count(*)::int AS n FROM users WHERE event_id = $1', [id])).rows[0].n).toBe(0);
  });
});

describe('navigateur déjà connecté avec un compte', () => {
  it("rejoindre ne remplace pas la session de l'organisateur", async () => {
    const inv = await invite(teamA, { kind: 'equipe' });
    const info = (await orga.get('/api/rejoindre/' + inv.token)).json();
    expect(info.connectedAs).toBeTruthy();
    const r = await orga.join(inv.token, 'Moi-même');
    expect(r.statusCode).toBe(409);
    expect((await orga.get('/api/events/' + eventId)).statusCode).toBe(200);
  });
});

describe('compte membre d’une équipe', () => {
  it("un organisateur ajouté à une équipe voit sa vue d'équipe en plus de l'organisation", async () => {
    expect((await orga.get('/api/events/' + eventId + '/mes-equipes')).json().teams).toEqual([]);
    const me = (await orga.get('/api/auth/me')).json();
    expect((await orga.post('/api/teams/' + teamB + '/members', { userId: me.id })).statusCode).toBe(200);
    const r = (await orga.get('/api/events/' + eventId + '/mes-equipes')).json();
    expect(r.teams).toHaveLength(1);
    expect(r.teams[0]).toMatchObject({ name: 'Équipe B', role: 'membre' });
    expect(r.teams[0].missions[0].point.name).toBe('Angle B');
    expect(r.event.instructions).toBe('Gilets obligatoires.');
    await orga.request('DELETE', '/api/teams/' + teamB + '/members/' + me.id);
  });
  it('inaccessible sans accès à la manifestation', async () => {
    await createUser(ctx.db, 'etranger', 'organisateur');
    const e = new Agent(ctx.app);
    await e.login('etranger');
    expect((await e.get('/api/events/' + eventId + '/mes-equipes')).statusCode).toBe(404);
  });
});
