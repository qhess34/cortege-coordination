// Types de SOS : liste par défaut à la création, configuration par l'organisation, refus hors organisation.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent, createUser, setup, type TestContext } from './helpers/app.js';

let ctx: TestContext;
let orga: Agent;
let autre: Agent;
let eventId: number;

beforeAll(async () => {
  ctx = await setup();
  await createUser(ctx.db, 'orga', 'organisateur');
  await createUser(ctx.db, 'autre', 'organisateur');
  orga = new Agent(ctx.app);
  await orga.login('orga');
  autre = new Agent(ctx.app);
  await autre.login('autre');
  eventId = (await orga.post('/api/events', { name: 'Manif' })).json().id;
});
afterAll(() => ctx.close());

describe('types de SOS', () => {
  it('quatre types par défaut à la création de la manifestation', async () => {
    const types = (await orga.get('/api/events/' + eventId + '/sos-types')).json();
    expect(types.map((t: { label: string }) => t.label)).toEqual(['Besoin de renforts', 'Besoin de secours', 'Agression', 'Problème / blocage']);
  });

  it('ajout, renommage et retrait par l’organisation', async () => {
    const added = await orga.post('/api/events/' + eventId + '/sos-types', { label: 'Perte de contact' });
    expect(added.statusCode).toBe(201);
    const id = added.json().id;
    expect(added.json().position).toBe(5);
    expect((await orga.patch('/api/events/' + eventId + '/sos-types/' + id, { label: 'Contact perdu' })).json().label).toBe('Contact perdu');
    expect((await orga.request('DELETE', '/api/events/' + eventId + '/sos-types/' + id)).statusCode).toBe(200);
    expect((await orga.get('/api/events/' + eventId + '/sos-types')).json().map((t: { label: string }) => t.label)).not.toContain('Contact perdu');
    // Type déjà retiré : introuvable.
    expect((await orga.patch('/api/events/' + eventId + '/sos-types/' + id, { label: 'X' })).statusCode).toBe(404);
  });

  it('refus : nom vide (400), hors de la manifestation (404)', async () => {
    expect((await orga.post('/api/events/' + eventId + '/sos-types', { label: '   ' })).statusCode).toBe(400);
    expect((await autre.post('/api/events/' + eventId + '/sos-types', { label: 'X' })).statusCode).toBe(404);
    expect((await autre.get('/api/events/' + eventId + '/sos-types')).statusCode).toBe(404);
  });
});
