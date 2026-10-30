// Lieux : les accès d'un même carrefour sont regroupés à la validation ; regroupement manuel, séparation, nom.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent, createUser, setup, type TestContext } from './helpers/app.js';
import { at, gpxFrom, referenceNetwork } from './helpers/osm.js';

let ctx: TestContext;
let orga: Agent;
let eventId: number;

interface P { id: number; name: string; place: { id: number; name: string; size: number } | null }
const point = async (id: number) => (await orga.get('/api/points/' + id)).json() as P;

beforeAll(async () => {
  ctx = await setup();
  await createUser(ctx.db, 'orga', 'organisateur');
  orga = new Agent(ctx.app);
  await orga.login('orga');
  eventId = (await orga.post('/api/events', { name: 'Lieux' })).json().id;
  ctx.osm.data = referenceNetwork();
  await orga.upload('/api/events/' + eventId + '/tracks', gpxFrom([[[0, 3], [250, -2], [500, 2]]], 'Rue A'));
});
afterAll(() => ctx.close());

describe('lieux', () => {
  it('les accès validés d’un même carrefour forment un lieu, nommé d’après le croisement', async () => {
    expect((await orga.post('/api/events/' + eventId + '/analyses', {})).statusCode).toBe(201);
    const all = (await orga.get('/api/events/' + eventId + '/suggestions')).json() as { id: number; junction: { nodeId: number } | null }[];
    const byNode = new Map<number, number[]>();
    for (const s of all) if (s.junction) byNode.set(s.junction.nodeId, [...(byNode.get(s.junction.nodeId) ?? []), s.id]);
    const pair = [...byNode.values()].find((ids) => ids.length >= 2)!;
    expect(pair).toBeDefined();
    const a = (await orga.post('/api/suggestions/' + pair[0] + '/validate', {})).json().pointId;
    // Un seul accès validé : pas encore de regroupement visible.
    expect((await point(a)).place).toBeNull();
    const b = (await orga.post('/api/suggestions/' + pair[1] + '/validate', {})).json().pointId;
    const pa = await point(a);
    const pb = await point(b);
    expect(pa.place).not.toBeNull();
    expect(pa.place!.id).toBe(pb.place!.id);
    expect(pa.place!.size).toBe(2);
    expect(pa.name).toMatch(/\(accès /);
    expect(pa.place!.name).not.toMatch(/accès/);

    // GPX de l'équipe : un POI par carrefour par défaut, un par accès sur option.
    const team = (await orga.post('/api/events/' + eventId + '/teams', { name: 'Carrefour', color: '#2a9d8f' })).json().id;
    await orga.post('/api/teams/' + team + '/missions', { pointId: a });
    await orga.post('/api/teams/' + team + '/missions', { pointId: b });
    const wpts = (body: string) => [...body.matchAll(/<wpt [^>]*><name>([^<]*)<\/name>/g)].map((m) => m[1]);
    const grouped = (await orga.get('/api/events/' + eventId + '/roadbook.gpx?team=' + team)).body;
    expect(wpts(grouped)).toEqual(['01 ' + pa.place!.name + ' (2 accès)']);
    expect(grouped).toContain('Accès : ');
    const perAccess = (await orga.get('/api/events/' + eventId + '/roadbook.gpx?team=' + team + '&regroupement=acces')).body;
    expect(wpts(perAccess)).toHaveLength(2);
    expect(wpts(perAccess)[0]).toMatch(/^01 .*\(accès /);
  });

  it('regroupement manuel, nom du lieu, séparation ; un lieu vide disparaît', async () => {
    const mk = async (name: string, x: number) => (await orga.post('/api/events/' + eventId + '/points', { name, position: at(x, 40) })).json().id as number;
    const p1 = await mk('Place Nord (accès est)', 100);
    const p2 = await mk('Place Nord (accès ouest)', 120);
    expect((await orga.post('/api/points/' + p1 + '/regrouper', { withPointId: p1 })).statusCode).toBe(400);
    const r = (await orga.post('/api/points/' + p2 + '/regrouper', { withPointId: p1 })).json() as P;
    expect(r.place).toMatchObject({ name: 'Place Nord', size: 2 });
    expect((await point(p1)).place!.id).toBe(r.place!.id);
    // Renommer le lieu.
    expect((await orga.patch('/api/places/' + r.place!.id, { name: 'Place du Nord' })).statusCode).toBe(200);
    expect((await point(p1)).place!.name).toBe('Place du Nord');
    // Séparer : le point redevient seul ; le lieu restant n'a plus qu'un point (plus de regroupement visible).
    expect((await orga.post('/api/points/' + p2 + '/separer')).json().place).toBeNull();
    expect((await point(p1)).place).toBeNull();
    expect((await orga.post('/api/points/' + p2 + '/separer')).statusCode).toBe(409);
    await orga.post('/api/points/' + p1 + '/separer');
    expect((await ctx.db.query('SELECT count(*)::int AS n FROM places WHERE id = $1', [r.place!.id])).rows[0].n).toBe(0);
  });

  it('réservé à l’organisation de la manifestation', async () => {
    await createUser(ctx.db, 'autre', 'organisateur');
    const autre = new Agent(ctx.app);
    await autre.login('autre');
    const p = (await orga.get('/api/events/' + eventId + '/points')).json()[0].id;
    expect((await autre.post('/api/points/' + p + '/separer')).statusCode).toBe(404);
    const place = (await ctx.db.query('SELECT id FROM places LIMIT 1')).rows[0].id;
    expect((await autre.patch('/api/places/' + place, { name: 'X' })).statusCode).toBe(404);
  });
});
