import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent, createUser, setup, type TestContext } from './helpers/app.js';
import { at, gpxFrom, referenceNetwork } from './helpers/osm.js';

let ctx: TestContext;
let orga: Agent;
let eventId: number;
let pointIds: number[];

interface Mission { id: number; position: number; status: string; version: number; pointId: number }
interface Team { id: number; name: string; missions: Mission[]; version: number; disabled: boolean }
const team = async (id: number) => ((await orga.get('/api/events/' + eventId + '/teams')).json() as Team[]).find((t) => t.id === id)!;

beforeAll(async () => {
  ctx = await setup();
  await createUser(ctx.db, 'orga', 'organisateur');
  orga = new Agent(ctx.app);
  await orga.login('orga');
  eventId = (await orga.post('/api/events', { name: 'Équipes' })).json().id;
  pointIds = [];
  for (let i = 1; i <= 4; i++) {
    pointIds.push((await orga.post('/api/events/' + eventId + '/points', { name: 'P' + i, position: at(i * 100, 0) })).json().id);
  }
});
afterAll(() => ctx.close());

describe('équipes', () => {
  let a: Team;
  let b: Team;

  it('crée des équipes et refuse les doublons de nom ou les couleurs invalides', async () => {
    a = (await orga.post('/api/events/' + eventId + '/teams', { name: 'Nord', color: '#1d3557' })).json();
    b = (await orga.post('/api/events/' + eventId + '/teams', { name: 'Sud', color: '#e76f51', description: 'Fin de parcours' })).json();
    expect(a.id).toBeGreaterThan(0);
    expect((await orga.post('/api/events/' + eventId + '/teams', { name: 'Nord', color: '#000000' })).statusCode).toBe(409);
    expect((await orga.post('/api/events/' + eventId + '/teams', { name: 'Est', color: 'rouge' })).statusCode).toBe(400);
  });

  it('désigne un responsable ayant accès à l\'événement', async () => {
    const outsider = await createUser(ctx.db, 'exterieur', 'aucun');
    expect((await orga.patch('/api/teams/' + a.id, { version: a.version, leaderUserId: outsider })).statusCode).toBe(400);
    await orga.put('/api/events/' + eventId + '/members', { userId: outsider, role: 'responsable' });
    const r = await orga.patch('/api/teams/' + a.id, { version: a.version, leaderUserId: outsider });
    expect(r.statusCode).toBe(200);
    expect(r.json().leaderName).toBe('exterieur');
  });

  it('affecte des points dans l\'ordre, y compris à un rang donné', async () => {
    await orga.post('/api/teams/' + a.id + '/missions', { pointId: pointIds[0] });
    await orga.post('/api/teams/' + a.id + '/missions', { pointId: pointIds[1] });
    const r = await orga.post('/api/teams/' + a.id + '/missions', { pointId: pointIds[2], position: 1 });
    expect(r.statusCode).toBe(201);
    expect(r.json().missions.map((m: Mission) => m.pointId)).toEqual([pointIds[2], pointIds[0], pointIds[1]]);
    expect(r.json().missions.map((m: Mission) => m.position)).toEqual([1, 2, 3]);
    expect((await orga.post('/api/teams/' + a.id + '/missions', { pointId: pointIds[0] })).statusCode).toBe(409);
  });

  it('réordonne les missions', async () => {
    const t = await team(a.id);
    const ids = t.missions.map((m) => m.id).reverse();
    const r = await orga.put('/api/teams/' + a.id + '/missions/order', { missionIds: ids });
    expect(r.statusCode).toBe(200);
    expect(r.json().missions.map((m: Mission) => m.id)).toEqual(ids);
    // Liste incomplète refusée.
    expect((await orga.put('/api/teams/' + a.id + '/missions/order', { missionIds: ids.slice(1) })).statusCode).toBe(409);
  });

  it('réaffecte une mission à une autre équipe et renumérote', async () => {
    const t = await team(a.id);
    const m = t.missions[0]!;
    const r = await orga.post('/api/missions/' + m.id + '/reassign', { teamId: b.id, version: m.version });
    expect(r.statusCode).toBe(200);
    expect(r.json().missions).toHaveLength(1);
    expect((await team(a.id)).missions.map((x) => x.position)).toEqual([1, 2]);
  });

  it('suit le statut : arrivée, fin, sans libérer le point', async () => {
    let m = (await team(b.id)).missions[0]!;
    const go = async (status: string) => {
      const r = await orga.post('/api/missions/' + m.id + '/status', { status, version: m.version });
      if (r.statusCode === 200) m = { ...m, ...r.json() };
      return r;
    };
    expect((await go('terminee')).statusCode).toBe(409); // on ne termine pas une mission non commencée
    expect((await go('en_deplacement')).statusCode).toBe(200);
    expect((await go('en_position')).statusCode).toBe(200);
    let p = (await orga.get('/api/points/' + m.pointId)).json();
    expect(p.status).toBe('mission_en_cours');
    expect((await go('terminee')).statusCode).toBe(200);
    p = (await orga.get('/api/points/' + m.pointId)).json();
    expect(p.status).toBe('mission_terminee');
    expect(p.missions).toHaveLength(1);
    // Version périmée refusée.
    expect((await orga.post('/api/missions/' + m.id + '/status', { status: 'affectee', version: m.version - 1 })).statusCode).toBe(409);
  });

  it('relève : la mission signale le besoin, une autre équipe peut prendre le point', async () => {
    let m = (await team(a.id)).missions[0]!;
    for (const s of ['en_position', 'releve_necessaire']) {
      const r = await orga.post('/api/missions/' + m.id + '/status', { status: s, version: m.version });
      expect(r.statusCode).toBe(200);
      m = { ...m, ...r.json() };
    }
    const r = await orga.post('/api/teams/' + b.id + '/missions', { pointId: m.pointId });
    expect(r.statusCode).toBe(201);
    const p = (await orga.get('/api/points/' + m.pointId)).json();
    expect(p.missions).toHaveLength(2);
  });

  it('désactive une équipe : ses points redeviennent « sans affectation » dans la synthèse', async () => {
    let s = (await orga.get('/api/events/' + eventId + '/summary')).json();
    expect(s.unassignedPoints.map((p: { id: number }) => p.id)).toEqual([pointIds[3]]);
    expect((await orga.post('/api/teams/' + a.id + '/disable', { disabled: true })).json().disabled).toBe(true);
    s = (await orga.get('/api/events/' + eventId + '/summary')).json();
    expect(s.unassignedPoints.length).toBeGreaterThan(1);
    expect((await orga.post('/api/teams/' + a.id + '/missions', { pointId: pointIds[3] })).statusCode).toBe(409);
    expect(s.teams).toEqual({ active: 1, total: 2 });
  });

  it('retire un point de la liste (mission annulée, historisée)', async () => {
    const t = await team(b.id);
    const r = await orga.delete('/api/missions/' + t.missions[0]!.id);
    expect(r.statusCode).toBe(200);
    expect(r.json().missions.map((m: Mission) => m.position)).toEqual([1]);
    const h = (await orga.get('/api/events/' + eventId + '/history?entity=mission')).json();
    expect(h[0].action).toBe('annulation');
  });

  it("refuse d'affecter un point d'un autre événement", async () => {
    const other = (await orga.post('/api/events', { name: 'Autre' })).json().id;
    const foreign = (await orga.post('/api/events/' + other + '/points', { name: 'Ailleurs', position: at(0, 0) })).json().id;
    expect((await orga.post('/api/teams/' + b.id + '/missions', { pointId: foreign })).statusCode).toBe(404);
  });
});

describe('suppression d’une manifestation', () => {
  it('supprime toutes les données après confirmation du nom, et seulement pour un organisateur', async () => {
    const id = (await orga.post('/api/events', { name: 'À supprimer' })).json().id;
    const p = (await orga.post('/api/events/' + id + '/points', { name: 'P', position: at(0, 0) })).json().id;
    const t = (await orga.post('/api/events/' + id + '/teams', { name: 'T', color: '#123456' })).json().id;
    await orga.post('/api/teams/' + t + '/missions', { pointId: p });

    const lecteur = await createUser(ctx.db, 'lecteur', 'aucun');
    await orga.put('/api/events/' + id + '/members', { userId: lecteur, role: 'membre' });
    const l = new Agent(ctx.app);
    await l.login('lecteur');
    expect((await l.request('DELETE', '/api/events/' + id, { confirmName: 'À supprimer' })).statusCode).toBe(403);

    expect((await orga.request('DELETE', '/api/events/' + id, { confirmName: 'Autre nom' })).statusCode).toBe(400);
    await orga.patch('/api/events/' + id, { status: 'en_cours', version: 1 });
    expect((await orga.request('DELETE', '/api/events/' + id, { confirmName: 'À supprimer' })).statusCode).toBe(409);
    await orga.patch('/api/events/' + id, { status: 'termine', version: 2 });

    expect((await orga.request('DELETE', '/api/events/' + id, { confirmName: 'À supprimer' })).statusCode).toBe(200);
    expect((await orga.get('/api/events/' + id)).statusCode).toBe(404);
    for (const table of ['mission_points', 'teams', 'missions', 'audit_logs']) {
      expect((await ctx.db.query('SELECT count(*)::int AS n FROM ' + table + ' WHERE event_id = $1', [id])).rows[0].n).toBe(0);
    }
    const trace = (await ctx.db.query("SELECT details FROM audit_logs WHERE entity = 'event' AND entity_id = $1 AND action = 'suppression'", [id])).rows;
    expect(trace[0].details).toMatchObject({ name: 'À supprimer', points: 1, teams: 1, missions: 1 });
  });

  it('supprime une manifestation avec parcours et analyse OSM', async () => {
    const id = (await orga.post('/api/events', { name: 'Avec parcours' })).json().id;
    await orga.upload('/api/events/' + id + '/tracks', gpxFrom([[[0, 3], [250, -2], [500, 2]]]));
    ctx.osm.data = referenceNetwork();
    expect((await orga.post('/api/events/' + id + '/analyses', {})).statusCode).toBe(201);
    const s = (await orga.get('/api/events/' + id + '/suggestions')).json();
    await orga.post('/api/suggestions/' + s[0].id + '/validate', {});
    expect((await orga.request('DELETE', '/api/events/' + id, { confirmName: 'Avec parcours' })).statusCode).toBe(200);
    expect((await ctx.db.query('SELECT count(*)::int AS n FROM gpx_tracks WHERE event_id = $1', [id])).rows[0].n).toBe(0);
  });
});
