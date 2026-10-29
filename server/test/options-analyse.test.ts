import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent, createUser, setup, type TestContext } from './helpers/app.js';
import { gpxFrom, referenceNetwork } from './helpers/osm.js';

let ctx: TestContext;
let orga: Agent;
let eventId: number;
const keys = async (status?: string) =>
  ((await orga.get('/api/events/' + eventId + '/suggestions' + (status ? '?status=' + status : ''))).json() as { stableKey: string; type: string }[]);

beforeAll(async () => {
  ctx = await setup();
  await createUser(ctx.db, 'orga', 'organisateur');
  orga = new Agent(ctx.app);
  await orga.login('orga');
  eventId = (await orga.post('/api/events', { name: 'Options' })).json().id;
  await orga.upload('/api/events/' + eventId + '/tracks', gpxFrom([[[0, 3], [250, -2], [500, 2]]]));
  ctx.osm.data = referenceNetwork();
});
afterAll(() => ctx.close());

describe('rues sortantes', () => {
  it("l'analyse peut ne pas les proposer, et l'option est mémorisée", async () => {
    const r = (await orga.post('/api/events/' + eventId + '/analyses', { includeOutgoing: false })).json();
    expect(r.merge.added.map((a: { stableKey: string }) => a.stableKey)).not.toContain('osm:n4-n30');
    expect((await keys()).some((s) => s.type === 'rue_laterale')).toBe(false);
    const summary = (await orga.get('/api/events/' + eventId + '/summary')).json();
    expect(summary.lastAnalysis.options.includeOutgoing).toBe(false);
  });

  it('les inclure ensuite les ajoute ; les exclure à nouveau ne les signale pas comme disparues', async () => {
    const r1 = (await orga.post('/api/events/' + eventId + '/analyses', { includeOutgoing: true })).json();
    expect(r1.merge.added.map((a: { stableKey: string }) => a.stableKey)).toEqual(['osm:n4-n30']);
    const r2 = (await orga.post('/api/events/' + eventId + '/analyses', { includeOutgoing: false })).json();
    expect(r2.merge.missing).toEqual([]);
    // Elles ne sont pas supprimées pour autant.
    expect((await keys()).map((s) => s.stableKey)).toContain('osm:n4-n30');
  });

  it('écarter toutes les rues sortantes en une fois, sans réapparition', async () => {
    const r = await orga.post('/api/events/' + eventId + '/suggestions/dismiss-type', { type: 'rue_laterale', reason: 'Rues sortantes non gérées' });
    expect(r.json()).toEqual({ dismissed: 1 });
    expect((await keys('ecartee')).map((s) => s.stableKey)).toEqual(['osm:n4-n30']);
    const again = (await orga.post('/api/events/' + eventId + '/analyses', { includeOutgoing: true })).json();
    expect(again.merge.added).toEqual([]);
    expect(again.merge.ignoredDismissed.map((a: { stableKey: string }) => a.stableKey)).toContain('osm:n4-n30');
    const h = (await orga.get('/api/events/' + eventId + '/history?entity=map_suggestion')).json();
    expect(h[0].action).toBe('exclusion_groupee');
  });

  it("l'action groupée est réservée aux organisateurs", async () => {
    const id = await createUser(ctx.db, 'membre', 'aucun');
    await orga.put('/api/events/' + eventId + '/members', { userId: id, role: 'membre' });
    const m = new Agent(ctx.app);
    await m.login('membre');
    expect((await m.post('/api/events/' + eventId + '/suggestions/dismiss-type', { type: 'carrefour' })).statusCode).toBe(403);
  });
});

describe('passage au mode par accès', () => {
  it("un carrefour écarté dans l'ancien mode n'est pas reproposé par ses accès", async () => {
    const id = (await orga.post('/api/events', { name: 'Ancien mode' })).json().id;
    await orga.upload('/api/events/' + id + '/tracks', gpxFrom([[[0, 3], [250, -2], [500, 2]]]));
    await orga.post('/api/events/' + id + '/analyses', { perAccess: false });
    const old = ((await orga.get('/api/events/' + id + '/suggestions')).json() as { id: number; stableKey: string }[]).find((x) => x.stableKey === 'osm:n3')!;
    await orga.post('/api/suggestions/' + old.id + '/dismiss', {});
    const m = (await orga.post('/api/events/' + id + '/analyses', {})).json().merge;
    const added = m.added.map((a: { stableKey: string }) => a.stableKey);
    expect(added).not.toContain('osm:n3-n20');
    expect(added).not.toContain('osm:n3-n21');
    expect(added).toContain('osm:n5-n40');
    expect(m.ignoredDismissed.map((a: { stableKey: string }) => a.stableKey)).toEqual(expect.arrayContaining(['osm:n3-n20', 'osm:n3-n21']));
  });
});
