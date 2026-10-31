// Jour J : vue de mission, statuts depuis le terrain, SOS, messages, progression, tableau de bord, direct.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent, createUser, memberAgent, setup, type TestContext } from './helpers/app.js';
import { at, gpxFrom } from './helpers/osm.js';

let ctx: TestContext;
let orga: Agent;
let alice: Agent; // membre de l'équipe A
let bob: Agent; // membre de l'équipe B
let eventId: number;
let teamA: number;
let teamB: number;
let missionA: number;

const mission = async (who: Agent) => (await who.get('/api/terrain/equipes/' + teamA)).json().missions[0];

beforeAll(async () => {
  ctx = await setup();
  await createUser(ctx.db, 'orga', 'organisateur');
  orga = new Agent(ctx.app);
  await orga.login('orga');
  eventId = (await orga.post('/api/events', { name: 'Jour J', instructions: 'Gilets.' })).json().id;
  await orga.upload('/api/events/' + eventId + '/tracks', gpxFrom([[[0, 0], [500, 0]]]));
  teamA = (await orga.post('/api/events/' + eventId + '/teams', { name: 'Équipe A', color: '#e63946' })).json().id;
  teamB = (await orga.post('/api/events/' + eventId + '/teams', { name: 'Équipe B', color: '#1d3557' })).json().id;
  const p = (await orga.post('/api/events/' + eventId + '/points', { name: 'Angle', position: at(200, 0) })).json().id;
  await orga.post('/api/teams/' + teamA + '/missions', { pointId: p });
  for (const [team, name] of [[teamA, 'Alice'], [teamB, 'Bob']] as const) {
    const a = await memberAgent(ctx, orga, team, name);
    if (name === 'Alice') alice = a; else bob = a;
  }
  missionA = (await mission(alice)).id;
});
afterAll(() => ctx.close());

describe('vue de mission', () => {
  it('le membre voit son équipe, ses missions et le parcours ; pas les autres équipes', async () => {
    const r = (await alice.get('/api/terrain/equipes/' + teamA)).json();
    expect(r.team.name).toBe('Équipe A');
    expect(r.me).toMatchObject({ displayName: 'Alice', role: 'membre', organizer: false });
    expect(r.missions).toHaveLength(1);
    expect(r.missions[0]).toMatchObject({ status: 'affectee', point: { name: 'Angle' } });
    expect(r.track[0].length).toBeGreaterThanOrEqual(2);
    expect(r.event.instructions).toBe('Gilets.');
    expect((await alice.get('/api/terrain/equipes/' + teamB)).statusCode).toBe(404);
    expect((await orga.get('/api/terrain/equipes/' + teamB)).statusCode).toBe(200);
  });
});

describe('statuts posés depuis le terrain', () => {
  it('en route, arrivé, terminé ; pas de retour en arrière ni de version périmée', async () => {
    let m = await mission(alice);
    const post = (who: Agent, status: string, version: number) => who.post('/api/terrain/missions/' + m.id + '/statut', { status, version });
    expect((await post(alice, 'en_deplacement', m.version)).statusCode).toBe(200);
    expect((await post(alice, 'en_position', m.version)).statusCode).toBe(409); // version périmée
    m = await mission(alice);
    expect((await post(alice, 'affectee', m.version)).statusCode).toBe(409); // retour réservé à l'organisation
    expect((await post(bob, 'en_position', m.version)).statusCode).toBe(404); // autre équipe
    expect((await post(alice, 'en_position', m.version)).statusCode).toBe(200);
    m = await mission(alice);
    expect(m.status).toBe('en_position');
    expect(m.statusChangedAt).toBeTruthy();
    const t = (await orga.get('/api/events/' + eventId + '/tableau')).json();
    expect(t.teams.find((x: { id: number }) => x.id === teamA).missions[0]).toMatchObject({ status: 'en_position', changedBy: 'Alice' });
  });
});

describe('SOS', () => {
  let sosId: number;
  let typeRenforts: number;
  let typeSecours: number;
  it('déclenchement : un type + un texte facultatif, lieu signalé ou point de la mission', async () => {
    // Les types par défaut sont créés à la création de la manifestation.
    const types = (await orga.get('/api/events/' + eventId + '/sos-types')).json();
    expect(types.map((t: { label: string }) => t.label)).toEqual(['Besoin de renforts', 'Besoin de secours', 'Agression', 'Problème / blocage']);
    typeRenforts = types[0].id;
    typeSecours = types[1].id;
    const r = await alice.post('/api/terrain/equipes/' + teamA + '/sos', { typeId: typeRenforts, message: 'Voiture qui force le passage', missionId: missionA, position: at(200, 5) });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ type: 'Besoin de renforts', status: 'ouvert', pointName: 'Angle', reporterName: 'Alice', teamName: 'Équipe A', message: 'Voiture qui force le passage' });
    expect(r.json().positionSource).toBe('signalee');
    expect(r.json().position[1]).toBeCloseTo(at(200, 5)[1], 6);
    sosId = r.json().id;
    // Sans position jointe : le lieu est celui du point de la mission (pour que l'équipe volante puisse s'y rendre).
    const sans = (await alice.post('/api/terrain/equipes/' + teamA + '/sos', { typeId: typeSecours, missionId: missionA })).json();
    expect(sans).toMatchObject({ type: 'Besoin de secours', positionSource: 'point', message: '' });
    expect(sans.position).not.toBeNull();
    // Sans mission ni position : aucun lieu.
    const hors = (await alice.post('/api/terrain/equipes/' + teamA + '/sos', { typeId: typeRenforts })).json();
    expect(hors).toMatchObject({ position: null, positionSource: null });
    // Un SOS ne change pas le statut de la mission.
    expect((await mission(alice)).status).not.toBe('incident');
    // Type inconnu refusé (400) ; une autre équipe ne peut pas signaler (404).
    expect((await alice.post('/api/terrain/equipes/' + teamA + '/sos', { typeId: 999999 })).statusCode).toBe(400);
    expect((await bob.post('/api/terrain/equipes/' + teamA + '/sos', { typeId: typeRenforts })).statusCode).toBe(404);
    const list = (await orga.get('/api/events/' + eventId + '/sos')).json();
    expect(list.map((s: { id: number }) => s.id)).toContain(sosId);
  });
  it('résolution par l’organisation ; un simple membre ne peut pas clore', async () => {
    const s = (await orga.get('/api/events/' + eventId + '/sos')).json().find((x: { id: number }) => x.id === sosId);
    expect((await alice.patch('/api/sos/' + s.id, { resolved: true, version: s.version })).statusCode).toBe(403);
    expect((await bob.patch('/api/sos/' + s.id, { resolved: true, version: s.version })).statusCode).toBe(404);
    const done = await orga.patch('/api/sos/' + s.id, { resolved: true, version: s.version });
    expect(done.json()).toMatchObject({ status: 'resolu', handledByName: expect.any(String) });
    expect(done.json().resolvedAt).toBeTruthy();
    // Version périmée refusée.
    expect((await orga.patch('/api/sos/' + s.id, { resolved: true, version: s.version })).statusCode).toBe(409);
  });
});

describe('messages', () => {
  it('annonce à tous et message d’équipe ; chacun ne voit que les siens ; accusés de lecture', async () => {
    const all = (await orga.post('/api/events/' + eventId + '/messages', { body: 'Départ dans 10 min', urgent: true })).json();
    await orga.post('/api/events/' + eventId + '/messages', { body: 'Équipe A : avancez au carrefour', teamId: teamA });
    const a = (await alice.get('/api/terrain/equipes/' + teamA)).json().messages;
    expect(a.map((m: { body: string }) => m.body)).toEqual(['Équipe A : avancez au carrefour', 'Départ dans 10 min']);
    expect(a.every((m: { read: boolean; fromOrganisation: boolean }) => !m.read && m.fromOrganisation)).toBe(true);
    const b = (await bob.get('/api/terrain/equipes/' + teamB)).json().messages;
    expect(b.map((m: { body: string }) => m.body)).toEqual(['Départ dans 10 min']);

    expect((await alice.post('/api/messages/' + all.id + '/lu')).statusCode).toBe(200);
    expect((await alice.post('/api/messages/' + all.id + '/lu')).statusCode).toBe(200);
    const teamMsg = a[0];
    expect((await bob.post('/api/messages/' + teamMsg.id + '/lu')).statusCode).toBe(404);
    const o = (await orga.get('/api/events/' + eventId + '/messages')).json();
    expect(o.find((m: { id: number }) => m.id === all.id)).toMatchObject({ reads: 1, recipients: 2, urgent: true });

    const reply = await alice.post('/api/terrain/equipes/' + teamA + '/messages', { body: 'Bien reçu' });
    expect(reply.statusCode).toBe(201);
    expect(reply.json()).toMatchObject({ authorName: 'Alice', fromOrganisation: false });
    expect((await bob.post('/api/events/' + eventId + '/messages', { body: 'Je me fais passer pour l’orga' })).statusCode).toBe(404);
  });
});

describe('progression déclarée', () => {
  it('déclarée par l’organisation (ou un responsable) ; un simple membre seulement « la tête est ici » par sa position', async () => {
    expect((await alice.post('/api/events/' + eventId + '/progression', { distance: 100 })).statusCode).toBe(403);
    expect((await alice.post('/api/events/' + eventId + '/progression', { part: 'queue', position: at(100, 5) })).statusCode).toBe(403);
    const here = await alice.post('/api/events/' + eventId + '/progression', { part: 'tete', position: at(100, 5) });
    expect(here.statusCode).toBe(201);
    expect(here.json().distance).toBe(100);
    expect((await new Agent(ctx.app).post('/api/events/' + eventId + '/progression', { part: 'tete', position: at(100, 5) })).statusCode).toBe(401);
    expect((await orga.post('/api/events/' + eventId + '/progression', { distance: 5000 })).statusCode).toBe(400);
    const r = await orga.post('/api/events/' + eventId + '/progression', { distance: 150, note: 'Tête place de la mairie' });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ distance: 150, note: 'Tête place de la mairie' });
    expect((await alice.get('/api/terrain/equipes/' + teamA)).json().progress.distance).toBe(150);
    const t = (await orga.get('/api/events/' + eventId + '/tableau')).json();
    expect(t.progress.distance).toBe(150);
    expect(t.teams.find((x: { id: number }) => x.id === teamA)).toMatchObject({ members: 1 });
  });
});

describe('direct (WebSocket)', () => {
  // Les messages sont collectés dès l'ouverture (le premier arrive avant la fin de la poignée de main).
  const open = async (who: Agent, ev: number) => {
    const queue: string[] = [];
    const waiters: ((m: string) => void)[] = [];
    let closed!: Promise<number>;
    const ws = await ctx.app.injectWS('/api/direct?event=' + ev, { headers: { cookie: who.cookie ?? '' } }, {
      onInit: (w) => {
        closed = new Promise<number>((resolve) => w.once('close', (c) => resolve(c)));
        w.on('message', (d) => { const w0 = waiters.shift(); if (w0) w0(String(d)); else queue.push(String(d)); });
      },
    });
    const next = () => new Promise<string>((resolve, reject) => {
      if (queue.length) return resolve(queue.shift()!);
      const t = setTimeout(() => reject(new Error('aucun message')), 3000);
      waiters.push((m) => { clearTimeout(t); resolve(m); });
    });
    return Object.assign(ws, { next, closed });
  };

  it('un membre reçoit un signal après une modification, sans aucune donnée', async () => {
    const ws = await open(alice, eventId);
    expect(JSON.parse(await ws.next()).type).toBe('connecte');
    const got = ws.next();
    await orga.post('/api/events/' + eventId + '/messages', { body: 'Signal' });
    const msg = JSON.parse(await got);
    expect(msg.type).toBe('maj');
    expect(Object.keys(msg).sort()).toEqual(['at', 'type']);
    ws.terminate();
  });
  it('refusé hors de sa manifestation ou sans session', async () => {
    const other = (await orga.post('/api/events', { name: 'Autre' })).json().id;
    for (const ws of [await open(alice, other), await open(new Agent(ctx.app), eventId)]) expect(await ws.closed).toBe(4404);
  });
});

describe('équipes volante, d’ouverture et de fermeture', () => {
  const joinTeam = async (kind: string, name: string) => {
    const team = (await orga.post('/api/events/' + eventId + '/teams', { name: 'Équipe ' + kind, color: '#6a4c93', kind })).json();
    expect(team.kind).toBe(kind);
    const a = await memberAgent(ctx, orga, team.id, name);
    return { team, agent: a };
  };

  it('l’ouverture déclare la tête (y compris par sa position), la fermeture la queue ; les points dépassés sont signalés', async () => {
    const tete = await joinTeam('ouverture', 'Olga');
    const queue = await joinTeam('fermeture', 'Félix');
    expect((await tete.agent.get('/api/terrain/equipes/' + tete.team.id)).json().canDeclare).toEqual({ tete: true, queue: false });
    expect((await queue.agent.post('/api/events/' + eventId + '/progression', { part: 'tete', distance: 300 })).statusCode).toBe(403);
    // « La tête est ici » : position projetée sur le parcours.
    const r = await tete.agent.post('/api/events/' + eventId + '/progression', { part: 'tete', position: at(320, 20) });
    expect(r.statusCode).toBe(201);
    expect(r.json().distance).toBeCloseTo(320, -1);
    expect((await tete.agent.post('/api/events/' + eventId + '/progression', { part: 'tete', position: at(320, 400) })).json().error).toMatch(/du parcours/);
    // La queue dépasse le point « Angle » (200 m).
    expect((await queue.agent.post('/api/events/' + eventId + '/progression', { part: 'queue', distance: 210 })).statusCode).toBe(201);
    const a = (await alice.get('/api/terrain/equipes/' + teamA)).json();
    expect(a.tail.distance).toBe(210);
    expect(a.missions[0].passedByTail).toBe(true);
    const t = (await orga.get('/api/events/' + eventId + '/tableau')).json();
    expect(t.tail.distance).toBe(210);
    expect(t.teams.find((x: { id: number }) => x.id === teamA).missions[0].passedByTail).toBe(true);
    expect(t.teams.find((x: { id: number }) => x.id === queue.team.id).kind).toBe('fermeture');
    // Équipes sans point fixe : elles voient les points tenus pour s'orienter.
    expect((await queue.agent.get('/api/terrain/equipes/' + queue.team.id)).json().eventPoints.map((p: { name: string }) => p.name)).toContain('Angle');
  });

  it('l’équipe volante voit et résout les SOS de toutes les équipes', async () => {
    const vol = await joinTeam('volante', 'Vic');
    const typeId = (await orga.get('/api/events/' + eventId + '/sos-types')).json()[3].id;
    const inc = (await bob.post('/api/terrain/equipes/' + teamB + '/sos', { typeId, message: 'Barrière tombée' })).json();
    const v = (await vol.agent.get('/api/terrain/equipes/' + vol.team.id)).json();
    expect(v.canHandleSos).toBe(true);
    expect(v.sos.map((s: { id: number }) => s.id)).toContain(inc.id);
    const done = await vol.agent.patch('/api/sos/' + inc.id, { resolved: true, version: inc.version });
    expect(done.json()).toMatchObject({ status: 'resolu', handledByName: 'Vic' });
    // Un membre d'une équipe à points fixes ne voit que les SOS de son équipe.
    expect((await alice.get('/api/terrain/equipes/' + teamA)).json().sos.map((s: { id: number }) => s.id)).not.toContain(inc.id);
    expect((await alice.patch('/api/sos/' + inc.id, { resolved: true, version: done.json().version })).statusCode).toBe(404);
  });
});
