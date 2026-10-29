import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseGpx } from '../src/geo/gpx.js';
import { Agent, createUser, setup, type TestContext } from './helpers/app.js';
import { at, gpxFrom, referenceNetwork } from './helpers/osm.js';

let ctx: TestContext;
let orga: Agent;
let eventId: number;
let nord: number;
let sud: number;

beforeAll(async () => {
  ctx = await setup();
  await createUser(ctx.db, 'orga', 'organisateur');
  orga = new Agent(ctx.app);
  await orga.login('orga');
  eventId = (await orga.post('/api/events', { name: 'Marche & roadbook', instructions: 'Gilets obligatoires.' })).json().id;
  await orga.upload('/api/events/' + eventId + '/tracks', gpxFrom([[[0, 3], [250, -2], [500, 2]]], 'Rue A', [{ name: 'Départ', x: 0, y: 0 }]));
  ctx.osm.data = referenceNetwork();
  await orga.post('/api/events/' + eventId + '/analyses', {});
  // Accès nord de la rue B (point d'accès d'un carrefour).
  const carrefour = ((await orga.get('/api/events/' + eventId + '/suggestions')).json() as { id: number; stableKey: string }[]).find((x) => x.stableKey === 'osm:n3-n21')!;
  const fromOsm = (await orga.post('/api/suggestions/' + carrefour.id + '/validate', {})).json().pointId;
  const a = (await orga.post('/api/events/' + eventId + '/points', { name: 'Angle <est>', description: 'Barrière', position: at(300, 10) })).json().id;
  await orga.post('/api/events/' + eventId + '/points', { name: 'Orphelin', position: at(450, 0) });
  nord = (await orga.post('/api/events/' + eventId + '/teams', { name: 'Nord', color: '#1d3557', instructions: 'Rester groupés.' })).json().id;
  sud = (await orga.post('/api/events/' + eventId + '/teams', { name: 'Sud', color: '#e63946' })).json().id;
  await orga.post('/api/teams/' + nord + '/missions', { pointId: a });
  await orga.post('/api/teams/' + nord + '/missions', { pointId: fromOsm, position: 1 });
});
afterAll(() => ctx.close());

describe('roadbook', () => {
  it('manifestation complète : consignes, parcours, équipes, missions ordonnées, points sans équipe', async () => {
    const rb = (await orga.get('/api/events/' + eventId + '/roadbook')).json();
    expect(rb.scope).toBe('manifestation');
    expect(rb.event.instructions).toBe('Gilets obligatoires.');
    expect(rb.track.length).toBeCloseTo(500, -1);
    expect(rb.track.waypoints[0].name).toBe('Départ');
    expect(rb.teams.map((t: { name: string }) => t.name)).toEqual(['Nord', 'Sud']);
    const n = rb.teams[0];
    expect(n.instructions).toBe('Rester groupés.');
    expect(n.missions.map((m: { order: number; point: { name: string } }) => [m.order, m.point.name])).toEqual([[1, 'Accès véhicules — Rue B côté nord (Rue A)'], [2, 'Angle <est>']]);
    // Un point issu d'OSM garde les informations utiles sur le terrain.
    expect(n.missions[0].point.osm.branches[0].name).toBe('Rue B');
    expect(n.missions[1].point.osm).toBeNull();
    expect(rb.unassigned.map((p: { name: string }) => p.name)).toEqual(['Orphelin']);
  });

  it("par équipe : seulement l'équipe demandée, sans les points orphelins", async () => {
    const rb = (await orga.get('/api/events/' + eventId + '/roadbook?team=' + sud)).json();
    expect(rb.scope).toBe('equipe');
    expect(rb.teams.map((t: { name: string }) => t.name)).toEqual(['Sud']);
    expect(rb.unassigned).toEqual([]);
    expect((await orga.get('/api/events/' + eventId + '/roadbook?team=999999')).statusCode).toBe(404);
  });

  it("GPX : points dans l'ordre de l'équipe et parcours, lisible par un logiciel GPX", async () => {
    const res = await orga.get('/api/events/' + eventId + '/roadbook.gpx?team=' + nord);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/gpx\+xml/);
    expect(res.headers['content-disposition']).toMatch(/filename="roadbook-marche-roadbook-nord\.gpx"/);
    expect(res.body).toContain('&lt;est&gt;');
    const g = parseGpx(res.body);
    expect(g.waypoints.map((w) => w.name)).toEqual(['01 Accès véhicules — Rue B côté nord (Rue A)', '02 Angle <est>']);
    expect(g.length).toBeCloseTo(500, -1);
  });

  it("réservé aux personnes ayant accès à la manifestation", async () => {
    await createUser(ctx.db, 'autre', 'organisateur');
    const autre = new Agent(ctx.app);
    await autre.login('autre');
    expect((await autre.get('/api/events/' + eventId + '/roadbook')).statusCode).toBe(404);
    expect((await autre.get('/api/events/' + eventId + '/roadbook.gpx')).statusCode).toBe(404);
    expect((await new Agent(ctx.app).get('/api/events/' + eventId + '/roadbook')).statusCode).toBe(401);
  });
});

describe('description initiale d’un point issu d’une suggestion', () => {
  it('une phrase simple, sans identifiant ni type de voie OSM', async () => {
    const rb = (await orga.get('/api/events/' + eventId + '/roadbook?team=' + nord)).json();
    const d: string = rb.teams[0].missions[0].point.description;
    expect(d).toBe('Accès côté nord par Rue B (double sens), sur Rue A.');
    expect(d).not.toMatch(/OSM|residential/);
  });
});
