// Partage de position en direct (facultatif) et arrivée automatique au point.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent, createUser, memberAgent, setup, type TestContext } from './helpers/app.js';
import { at, gpxFrom } from './helpers/osm.js';

let ctx: TestContext;
let orga: Agent;
let alice: Agent;
let bob: Agent;
let eventId: number;
let teamA: number;
let teamB: number;

const terrain = async (who: Agent, team: number) => (await who.get('/api/terrain/equipes/' + team)).json();
const send = (who: Agent, team: number, x: number, y: number, accuracy: number | null = 10) =>
  who.post('/api/terrain/equipes/' + team + '/position', { position: at(x, y), accuracy });

beforeAll(async () => {
  ctx = await setup();
  await createUser(ctx.db, 'orga', 'organisateur');
  await createUser(ctx.db, 'lecteur', 'organisateur');
  orga = new Agent(ctx.app);
  await orga.login('orga');
  eventId = (await orga.post('/api/events', { name: 'Suivi' })).json().id;
  await orga.upload('/api/events/' + eventId + '/tracks', gpxFrom([[[0, 0], [500, 0]]]));
  teamA = (await orga.post('/api/events/' + eventId + '/teams', { name: 'A', color: '#e63946' })).json().id;
  teamB = (await orga.post('/api/events/' + eventId + '/teams', { name: 'B', color: '#1d3557' })).json().id;
  for (const [x, name] of [[200, 'Premier'], [400, 'Second']] as const) {
    const p = (await orga.post('/api/events/' + eventId + '/points', { name, position: at(x, 0) })).json().id;
    await orga.post('/api/teams/' + teamA + '/missions', { pointId: p });
  }
  for (const [team, name] of [[teamA, 'Alice'], [teamB, 'Bob']] as const) {
    const a = await memberAgent(ctx, orga, team, name);
    if (name === 'Alice') alice = a; else bob = a;
  }
});
afterAll(() => ctx.close());

describe('partage de position', () => {
  it('refusé tant que l’organisation ne l’a pas autorisé', async () => {
    expect((await terrain(alice, teamA)).locationSharing).toBe(false);
    expect((await send(alice, teamA, 0, 0)).statusCode).toBe(409);
    const ev = (await orga.get('/api/events/' + eventId)).json();
    expect((await orga.patch('/api/events/' + eventId, { locationSharing: true, version: ev.version })).json().locationSharing).toBe(true);
  });

  it('seule la dernière position est gardée, visible de l’organisation seulement', async () => {
    const auditCount = async () => (await ctx.db.query('SELECT count(*)::int AS n FROM audit_logs')).rows[0].n;
    const before = await auditCount();
    expect((await send(alice, teamA, 50, 10)).json()).toMatchObject({ ok: true, arrived: null });
    expect((await send(alice, teamA, 60, 10)).statusCode).toBe(200);
    expect((await send(bob, teamA, 0, 0)).statusCode).toBe(404);
    expect((await ctx.db.query('SELECT count(*)::int AS n FROM member_locations')).rows[0].n).toBe(1);
    const list = (await orga.get('/api/events/' + eventId + '/positions')).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ displayName: 'Alice', teamName: 'A', accuracy: 10 });
    expect(list[0].position[0]).toBeCloseTo(at(60, 10)[0], 6);
    expect((await alice.get('/api/events/' + eventId + '/positions')).statusCode).toBe(404);
    // Rien dans le journal d'audit (aucun historique des positions).
    expect(await auditCount()).toBe(before);
    expect((await terrain(alice, teamA)).sharing).toBe(true);
  });

  it('arrivée automatique à moins de 30 m du point, si la précision le permet', async () => {
    expect((await send(alice, teamA, 185, 5, 120)).json().arrived).toBeNull(); // précision insuffisante
    const r = (await send(alice, teamA, 190, 8)).json();
    expect(r.arrived).toMatchObject({ pointName: 'Premier' });
    const m = (await terrain(alice, teamA)).missions;
    expect(m[0].status).toBe('en_position');
    // Chaque point encore à tenir est pris dès qu'on s'en approche : l'équipe en tient plusieurs à la fois
    // (le compteur « en position » progresse, il ne reste pas bloqué sur le premier point).
    expect((await send(alice, teamA, 400, 0)).json().arrived).toMatchObject({ pointName: 'Second' });
    expect((await terrain(alice, teamA)).missions.filter((x: { status: string }) => x.status === 'en_position')).toHaveLength(2);
    const t = (await orga.get('/api/events/' + eventId + '/tableau')).json();
    expect(t.teams.find((x: { id: number }) => x.id === teamA).missions.find((x: { pointName: string }) => x.pointName === 'Premier').changedBy).toBe('Alice');
  });

  it('arrêt du partage, désactivation par l’organisation : la position est effacée', async () => {
    expect((await alice.request('DELETE', '/api/terrain/position')).statusCode).toBe(200);
    expect((await orga.get('/api/events/' + eventId + '/positions')).json()).toHaveLength(0);
    await send(alice, teamA, 10, 10);
    const ev = (await orga.get('/api/events/' + eventId)).json();
    await orga.patch('/api/events/' + eventId, { locationSharing: false, version: ev.version });
    expect((await ctx.db.query('SELECT count(*)::int AS n FROM member_locations')).rows[0].n).toBe(0);
  });

  it('un membre retiré de l’équipe ne laisse aucune position', async () => {
    const ev = (await orga.get('/api/events/' + eventId)).json();
    await orga.patch('/api/events/' + eventId, { locationSharing: true, version: ev.version });
    await send(bob, teamB, 0, 0);
    const bobId = (await orga.get('/api/teams/' + teamB + '/members')).json()[0].id;
    await orga.request('DELETE', '/api/teams/' + teamB + '/members/' + bobId);
    expect((await ctx.db.query('SELECT count(*)::int AS n FROM member_locations WHERE user_id = $1', [bobId])).rows[0].n).toBe(0);
  });
});

describe('progression automatique du cortège', () => {
  it('tête et queue suivent les positions des équipes d’ouverture et de fermeture', async () => {
    const head = (await orga.post('/api/events/' + eventId + '/teams', { name: 'Ouverture', color: '#2a9d8f', kind: 'ouverture' })).json().id;
    const tail = (await orga.post('/api/events/' + eventId + '/teams', { name: 'Fermeture', color: '#264653', kind: 'fermeture' })).json().id;
    const h1 = await memberAgent(ctx, orga, head, 'Tête 1');
    const h2 = await memberAgent(ctx, orga, head, 'Tête 2');
    const q1 = await memberAgent(ctx, orga, tail, 'Queue 1');
    const tableau = async () => (await orga.get('/api/events/' + eventId + '/tableau')).json();
    // Les progressions précédentes datent de plus d'une minute (sinon elles ne sont pas remplacées).
    const age = () => ctx.db.query("UPDATE event_progress SET created_at = created_at - interval '2 minutes' WHERE event_id = $1", [eventId]);

    await send(h1, head, 150, 5);
    expect((await tableau()).progress).toMatchObject({ distance: 150, note: 'automatique (positions)', authorName: null });
    // Au plus une par minute.
    await send(h1, head, 180, 5);
    expect((await tableau()).progress.distance).toBe(150);
    // Plusieurs membres de l'ouverture : la tête est la plus avancée ; une position loin du parcours est ignorée.
    await age();
    await send(h2, head, 260, 0);
    await send(h1, head, 230, 400);
    expect((await tableau()).progress.distance).toBe(260);
    // Position imprécise : ignorée.
    await age();
    await send(h2, head, 350, 0, 500);
    expect((await tableau()).progress.distance).toBe(260);

    // Queue : la fermeture dépasse le premier point (200 m), il apparaît « à lever ».
    await send(q1, tail, 120, 0);
    let t = await tableau();
    expect(t.tail.distance).toBe(120);
    const premier = (x: typeof t) => x.teams.find((y: { id: number }) => y.id === teamA).missions.find((m: { pointName: string }) => m.pointName === 'Premier');
    expect(premier(t).passedByTail).toBe(false);
    await age();
    await send(q1, tail, 210, 0);
    t = await tableau();
    expect(t.tail.distance).toBe(210);
    expect(premier(t).passedByTail).toBe(true);
    // Une équipe à points fixes ne fait pas avancer le cortège.
    await age();
    await send(alice, teamA, 450, 0);
    expect((await tableau()).progress.distance).toBe(260);
  });
});
