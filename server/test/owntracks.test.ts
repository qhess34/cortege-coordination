// Suivi en arrière-plan avec OwnTracks : configuration, réception des positions, zones, révocation.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent, createUser, memberAgent, setup, type TestContext } from './helpers/app.js';
import { at, gpxFrom } from './helpers/osm.js';

let ctx: TestContext;
let orga: Agent;
let alice: Agent;
let eventId: number;
let teamA: number;
let link: string;

/** Configuration décodée du lien owntracks:///config?inline=… */
const decode = (l: string) => JSON.parse(Buffer.from(l.split('inline=')[1]!, 'base64').toString('utf8'));
/** Message envoyé par l'application (sans cookie ni en-tête CSRF, comme OwnTracks). */
const otPost = (user: string, password: string, body: unknown) => ctx.app.inject({
  method: 'POST', url: '/api/owntracks',
  headers: { authorization: 'Basic ' + Buffer.from(user + ':' + password).toString('base64'), 'content-type': 'application/json', 'x-limit-u': user, 'x-limit-d': 'cortege' },
  payload: body === '' ? '' : JSON.stringify(body),
});
const loc = (x: number, y: number, extra: Record<string, unknown> = {}) => {
  const [lon, lat] = at(x, y);
  return { _type: 'location', lat, lon, acc: 8, batt: 76, tid: 'AL', tst: Math.floor(Date.now() / 1000), ...extra };
};

beforeAll(async () => {
  ctx = await setup();
  await createUser(ctx.db, 'orga', 'organisateur');
  orga = new Agent(ctx.app);
  await orga.login('orga');
  eventId = (await orga.post('/api/events', { name: 'OwnTracks', locationSharing: true })).json().id;
  await orga.upload('/api/events/' + eventId + '/tracks', gpxFrom([[[0, 0], [500, 0]]]));
  teamA = (await orga.post('/api/events/' + eventId + '/teams', { name: 'A', color: '#e63946' })).json().id;
  for (const [x, name] of [[200, 'Premier'], [400, 'Second']] as const) {
    const p = (await orga.post('/api/events/' + eventId + '/points', { name, position: at(x, 0) })).json().id;
    await orga.post('/api/teams/' + teamA + '/missions', { pointId: p });
  }
  alice = await memberAgent(ctx, orga, teamA, 'Alice Martin');
});
afterAll(() => ctx.close());

describe('configuration', () => {
  it('lien de configuration HTTP, avec les points de mission comme zones ; secret haché seulement', async () => {
    const r = await alice.post('/api/terrain/equipes/' + teamA + '/owntracks');
    expect(r.statusCode).toBe(201);
    link = r.json().link;
    expect(link).toMatch(/^owntracks:\/\/\/config\?inline=/);
    const conf = decode(link);
    expect(conf).toMatchObject({ _type: 'configuration', mode: 3, url: 'https://cortege.test/api/owntracks', auth: true, tid: 'AM', monitoring: 2, cmd: true });
    expect(conf.username).toBe(r.json().trackerId);
    expect(conf.waypoints.map((w: { desc: string; rad: number }) => [w.desc.split(' #')[0], w.rad])).toEqual([['Premier', 50], ['Second', 50]]);
    const row = (await ctx.db.query('SELECT secret_hash FROM trackers WHERE id = $1', [conf.username])).rows[0];
    expect(Buffer.from(row.secret_hash).toString('utf8')).not.toContain(conf.password);
    // Un organisateur qui n'est pas dans l'équipe ne peut pas se faire suivre à sa place.
    expect((await orga.post('/api/terrain/equipes/' + teamA + '/owntracks')).statusCode).toBe(403);
  });
});

describe('réception', () => {
  it('refuse un secret inconnu ; accepte un corps vide', async () => {
    const { username } = decode(link);
    expect((await otPost(username, 'mauvais', loc(0, 0))).statusCode).toBe(401);
    expect((await otPost('inconnu', 'x', loc(0, 0))).statusCode).toBe(401);
    const empty = await otPost(username, decode(link).password, '');
    expect(empty.statusCode).toBe(200);
  });

  it('position enregistrée (dernière seulement), batterie, visible de l’organisation', async () => {
    const { username, password } = decode(link);
    const r = await otPost(username, password, loc(100, 10));
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual([]); // zones déjà à jour
    const list = (await orga.get('/api/events/' + eventId + '/positions')).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ displayName: 'Alice Martin', source: 'owntracks', battery: 76, accuracy: 8 });
    const trackers = (await orga.get('/api/events/' + eventId + '/trackers')).json();
    expect(trackers[0]).toMatchObject({ displayName: 'Alice Martin', battery: 76 });
    expect(trackers[0].lastSeenAt).toBeTruthy();
  });

  it('une position ancienne (envoyée en différé) ne remplace pas la position en direct', async () => {
    const { username, password } = decode(link);
    await otPost(username, password, loc(300, 0, { tst: Math.floor(Date.now() / 1000) - 3600 }));
    const p = (await orga.get('/api/events/' + eventId + '/positions')).json()[0];
    expect(p.position[0]).toBeCloseTo(at(100, 10)[0], 6);
  });

  it('entrée dans la zone du point : arrivée enregistrée, même avec une position imprécise', async () => {
    const { username, password, waypoints } = decode(link);
    const first = waypoints[0];
    const r = await otPost(username, password, { ...loc(170, 20, { acc: 120 }), _type: 'transition', event: 'enter', rid: first.rid, desc: first.desc, t: 'c' });
    expect(r.statusCode).toBe(200);
    const m = (await alice.get('/api/terrain/equipes/' + teamA)).json().missions;
    expect(m[0].status).toBe('en_position');
    expect((await ctx.db.query("SELECT details FROM audit_logs WHERE entity = 'mission' AND action = 'statut' ORDER BY id DESC LIMIT 1")).rows[0].details).toMatchObject({ auto: true });
  });

  it('missions modifiées : les zones à jour sont renvoyées dans la réponse', async () => {
    const { username, password } = decode(link);
    const m = (await alice.get('/api/terrain/equipes/' + teamA)).json().missions;
    // Le premier point est terminé : il quitte la liste des zones.
    await orga.post('/api/missions/' + m[0].id + '/status', { status: 'terminee', version: m[0].version });
    const r = (await otPost(username, password, loc(250, 0))).json();
    expect(r.map((x: { action: string }) => x.action)).toEqual(['clearWaypoints', 'setWaypoints']);
    expect(r[1].waypoints.waypoints.map((w: { desc: string }) => w.desc.split(' #')[0])).toEqual(['Second']);
    expect((await otPost(username, password, loc(255, 0))).json()).toEqual([]);
  });
});

describe('arrêt', () => {
  it('révoqué par l’organisation : position effacée et application mise au repos', async () => {
    const { username, password } = decode(link);
    expect((await orga.post('/api/trackers/' + username + '/revoke')).statusCode).toBe(200);
    expect((await orga.get('/api/events/' + eventId + '/positions')).json()).toHaveLength(0);
    const r = (await otPost(username, password, loc(260, 0))).json();
    expect(r[0]).toMatchObject({ _type: 'cmd', action: 'setConfiguration', configuration: { monitoring: -1 } });
    expect((await orga.get('/api/events/' + eventId + '/positions')).json()).toHaveLength(0);
  });

  it('reconfigurer révoque l’ancien téléphone ; arrêt par le membre ; partage coupé = repos', async () => {
    const a = decode((await alice.post('/api/terrain/equipes/' + teamA + '/owntracks')).json().link);
    const b = decode((await alice.post('/api/terrain/equipes/' + teamA + '/owntracks')).json().link);
    expect((await otPost(a.username, a.password, loc(10, 0))).json()[0]?.action).toBe('setConfiguration');
    expect((await otPost(b.username, b.password, loc(10, 0))).json()).toEqual([]);
    expect((await alice.request('DELETE', '/api/terrain/owntracks')).statusCode).toBe(200);
    expect((await otPost(b.username, b.password, loc(10, 0))).json()[0]?.action).toBe('setConfiguration');
    const c = decode((await alice.post('/api/terrain/equipes/' + teamA + '/owntracks')).json().link);
    const ev = (await orga.get('/api/events/' + eventId)).json();
    await orga.patch('/api/events/' + eventId, { locationSharing: false, version: ev.version });
    expect((await otPost(c.username, c.password, loc(10, 0))).json()[0]?.action).toBe('setConfiguration');
    expect((await ctx.db.query('SELECT count(*)::int AS n FROM member_locations')).rows[0].n).toBe(0);
  });

  it('jamais de secret dans le journal d’audit', async () => {
    const audit = (await ctx.db.query('SELECT details::text AS d FROM audit_logs')).rows.map((r) => r.d).join('\n');
    expect(audit).not.toContain(decode(link).password);
  });
});
