// Nom de lieu : rue la plus proche, ou croisement de deux rues partageant un nœud.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { placeName } from '../src/geo/place-name.js';
import { Agent, createUser, setup, type TestContext } from './helpers/app.js';
import { OsmBuilder, at, gpxFrom, referenceNetwork } from './helpers/osm.js';

function network() {
  const b = new OsmBuilder();
  b.node(1, -200, 0); b.node(2, 0, 0); b.node(3, 200, 0);
  b.node(4, 0, -200); b.node(5, 0, 200);
  b.node(6, 100, -10); b.node(7, 100, 10); // passerelle sans nœud commun
  b.way(10, [1, 2, 3], { highway: 'residential', name: 'Rue de la Paix' });
  b.way(11, [4, 2, 5], { highway: 'tertiary', name: 'Avenue Foch' });
  b.way(12, [6, 7], { highway: 'footway', name: 'Passerelle', bridge: 'yes' });
  b.way(13, [1, 4], { highway: 'service' });
  return b.build();
}

describe('placeName', () => {
  it('donne le nom de la rue la plus proche', () => {
    expect(placeName(network(), at(-120, 5)).name).toBe('Rue de la Paix');
  });
  it('nomme un croisement « rue la plus proche × autre rue »', () => {
    expect(placeName(network(), at(3, 8))).toEqual({ name: 'Avenue Foch × Rue de la Paix', streets: ['Avenue Foch', 'Rue de la Paix'] });
  });
  it("ne parle pas de croisement quand les voies ne se rejoignent pas (pont, passerelle)", () => {
    expect(placeName(network(), at(100, 2)).name).toBe('Rue de la Paix');
  });
  it('rien de nommé à proximité', () => {
    expect(placeName(network(), at(-150, -150))).toEqual({ name: null, streets: [] });
  });
});

describe('GET /api/events/:id/nom-de-lieu', () => {
  let ctx: TestContext;
  let orga: Agent;
  let eventId: number;
  beforeAll(async () => {
    ctx = await setup();
    await createUser(ctx.db, 'orga', 'organisateur');
    await createUser(ctx.db, 'autre', 'organisateur');
    orga = new Agent(ctx.app);
    await orga.login('orga');
    eventId = (await orga.post('/api/events', { name: 'Noms' })).json().id;
  });
  afterAll(() => ctx.close());

  it('propose le nom du croisement', async () => {
    ctx.osm.data = network();
    const [lon, lat] = at(3, 8);
    const r = await orga.get('/api/events/' + eventId + '/nom-de-lieu?lon=' + lon + '&lat=' + lat);
    expect(r.json().name).toBe('Avenue Foch × Rue de la Paix');
    expect(ctx.osm.queries.at(-1)).toContain('around:');
  });
  it('renvoie un nom vide si Overpass ne répond pas', async () => {
    ctx.osm.fail = new Error('HTTP 504');
    const r = await orga.get('/api/events/' + eventId + '/nom-de-lieu?lon=2.35&lat=48.85');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ name: null, unavailable: true });
    ctx.osm.fail = null;
  });
  it("utilise les rues relevées par la dernière analyse, sans interroger Overpass", async () => {
    await orga.upload('/api/events/' + eventId + '/tracks', gpxFrom([[[0, 3], [250, -2], [500, 2]]]));
    ctx.osm.data = referenceNetwork();
    expect((await orga.post('/api/events/' + eventId + '/analyses', {})).statusCode).toBe(201);
    const before = ctx.osm.queries.length;
    ctx.osm.fail = new Error('Overpass ne doit pas être appelé');
    const [lon, lat] = at(250, 3);
    const r = (await orga.get('/api/events/' + eventId + '/nom-de-lieu?lon=' + lon + '&lat=' + lat)).json();
    ctx.osm.fail = null;
    expect(r.source).toBe('analyse');
    expect(r.name).toMatch(/^Rue A( × .+)?$/);
    expect(ctx.osm.queries.length).toBe(before);
  });
  it("réservé aux organisateurs de l'événement", async () => {
    const autre = new Agent(ctx.app);
    await autre.login('autre');
    expect((await autre.get('/api/events/' + eventId + '/nom-de-lieu?lon=2.35&lat=48.85')).statusCode).toBe(404);
  });
});
