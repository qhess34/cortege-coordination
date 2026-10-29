import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent, createUser, setup, type TestContext } from './helpers/app.js';
import { gpxFrom, referenceNetwork } from './helpers/osm.js';

let ctx: TestContext;
let orga: Agent;
let eventId: number;
const count = async (table: string) => (await ctx.db.query('SELECT count(*)::int AS n FROM ' + table + ' WHERE event_id = $1', [eventId])).rows[0].n;

beforeAll(async () => {
  ctx = await setup();
  await createUser(ctx.db, 'orga', 'organisateur');
  orga = new Agent(ctx.app);
  await orga.login('orga');
  eventId = (await orga.post('/api/events', { name: 'Overpass capricieux' })).json().id;
  // Deux segments : deux tronçons interrogés séparément.
  await orga.upload('/api/events/' + eventId + '/tracks', gpxFrom([[[0, 3], [250, -2], [500, 2]], [[500, 2], [700, 2]]]));
});
afterAll(() => ctx.close());

describe('réponses Overpass vides ou lentes', () => {
  it("aucune voie nulle part : erreur explicite, rien n'est enregistré", async () => {
    ctx.osm.data = { elements: [] };
    const r = await orga.post('/api/events/' + eventId + '/analyses', {});
    expect(r.statusCode).toBe(502);
    expect(r.json().error).toMatch(/aucune voie autour du parcours/);
    expect(await count('osm_analyses')).toBe(0);
    expect(await count('map_suggestions')).toBe(0);
  });

  it('tronçon vide : analyse faite, avertissement dans le rapport', async () => {
    ctx.osm.respond = (q, n) => (n % 2 === 0 ? { elements: [] } : referenceNetwork());
    const r = await orga.post('/api/events/' + eventId + '/analyses', {});
    ctx.osm.respond = null;
    expect(r.statusCode).toBe(201);
    expect(r.json().warnings).toEqual([expect.stringMatching(/aucune voie pour 1 tronçon\(s\) sur 2/)]);
    expect(r.json().merge.added.length).toBeGreaterThan(0);
  });

  it('en tâche de fond : réponse immédiate, puis avancement et résultat', async () => {
    ctx.osm.data = referenceNetwork();
    const start = await orga.post('/api/events/' + eventId + '/analyses?async=1', {});
    expect(start.statusCode).toBe(202);
    const { jobId } = start.json();
    let job;
    for (let i = 0; i < 50; i++) {
      job = (await orga.get('/api/analyses/taches/' + jobId)).json();
      if (job.status !== 'en_cours') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(job.status).toBe('termine');
    expect(job.progress).toEqual({ done: 2, total: 2 });
    expect(job.result.merge).toBeDefined();
    // Suivi réservé aux organisateurs de l'événement.
    await createUser(ctx.db, 'autre', 'organisateur');
    const autre = new Agent(ctx.app);
    await autre.login('autre');
    expect((await autre.get('/api/analyses/taches/' + jobId)).statusCode).toBe(404);
  });

  it('en tâche de fond : un échec est rapporté avec son message', async () => {
    ctx.osm.fail = new Error('Serveur Overpass saturé (HTTP 504)');
    const { jobId } = (await orga.post('/api/events/' + eventId + '/analyses?async=1', {})).json();
    let job;
    for (let i = 0; i < 50; i++) {
      job = (await orga.get('/api/analyses/taches/' + jobId)).json();
      if (job.status !== 'en_cours') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    ctx.osm.fail = null;
    expect(job.status).toBe('echec');
    expect(job.error).toMatch(/Données OSM indisponibles.*504/);
  });
});
