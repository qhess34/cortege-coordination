import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OverpassResponse } from '../src/geo/osm-analysis.js';
import { Agent, createUser, setup, type TestContext } from './helpers/app.js';
import { at, gpxFrom, referenceNetwork } from './helpers/osm.js';

let ctx: TestContext;
let orga: Agent;
let eventId: number;

interface S { id: number; stableKey: string; status: string; type: string; pointId: number | null; pendingUpdate: unknown }
const suggestions = async (q = '') => (await orga.get('/api/events/' + eventId + '/suggestions' + q)).json() as S[];
const byKey = async (k: string) => (await suggestions()).find((s) => s.stableKey === k)!;
const points = async (q = '') => (await orga.get('/api/events/' + eventId + '/points' + q)).json() as { id: number; name: string; status: string; distance: number; version: number; origin: string }[];

beforeAll(async () => {
  ctx = await setup();
  await createUser(ctx.db, 'orga', 'organisateur');
  orga = new Agent(ctx.app);
  await orga.login('orga');
  eventId = (await orga.post('/api/events', { name: 'Cortège test', startsAt: '2026-05-01T14:00:00+02:00', areaName: 'Paris' })).json().id;
  ctx.osm.data = referenceNetwork();
});
afterAll(() => ctx.close());

describe('import GPX', () => {
  it('refuse un fichier invalide avec un message explicite', async () => {
    const r = await orga.upload('/api/events/' + eventId + '/tracks', '<html>pas un gpx</html>');
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/pas un GPX/);
  });

  it('importe le parcours et calcule sa longueur', async () => {
    const r = await orga.upload('/api/events/' + eventId + '/tracks', gpxFrom([[[0, 3], [250, -2], [500, 2]]], 'Rue A', [{ name: 'Départ', x: 0, y: 0 }]));
    expect(r.statusCode).toBe(201);
    expect(r.json().version).toBe(1);
    const t = (await orga.get('/api/events/' + eventId + '/track')).json();
    expect(t.track.length).toBeCloseTo(500, -1);
    expect(t.track.geometry.type).toBe('MultiLineString');
    expect(t.waypoints[0].name).toBe('Départ');
  });
});

describe('analyse OSM', () => {
  it('propose des suggestions explicables', async () => {
    const r = await orga.post('/api/events/' + eventId + '/analyses', {});
    expect(r.statusCode).toBe(201);
    expect(ctx.osm.queries[0]).toMatch(/way\(around:40,/);
    const report = r.json();
    expect(report.merge.added).toHaveLength(6);
    expect(report.ignoredCrossings).toHaveLength(1);
    const list = await suggestions();
    expect(list.every((s) => s.status === 'a_examiner')).toBe(true);
    const c = (await orga.get('/api/events/' + eventId + '/suggestions?type=carrefour')).json()[0];
    expect(c.reasons.length).toBeGreaterThan(0);
    expect(c.distance).toBeCloseTo(100, -1);
    expect(c.branches[0].name).toBe('Rue B');
  });

  it("valide et écarte des suggestions", async () => {
    const c = await byKey('osm:n3');
    const v = await orga.post('/api/suggestions/' + c.id + '/validate', {});
    expect(v.statusCode).toBe(201);
    expect((await orga.post('/api/suggestions/' + c.id + '/validate', {})).statusCode).toBe(409);
    const foot = await byKey('osm:n2');
    expect((await orga.post('/api/suggestions/' + foot.id + '/dismiss', { reason: 'Sentier fermé' })).statusCode).toBe(200);
    // Une suggestion devenue point ne peut pas être écartée sans supprimer le point.
    expect((await orga.post('/api/suggestions/' + c.id + '/dismiss', {})).statusCode).toBe(409);
    const pts = await points();
    expect(pts).toHaveLength(1);
    expect(pts[0]).toMatchObject({ origin: 'suggestion', status: 'valide' });
    expect(pts[0]!.name).toMatch(/Carrefour/);
  });

  it('nouvelle analyse non destructive : conserve, ne réintroduit pas, ne duplique pas', async () => {
    // Un point manuel, et une équipe qui a le point validé.
    const manual = (await orga.post('/api/events/' + eventId + '/points', { name: 'Point manuel', position: at(420, 0) })).json();
    const team = (await orga.post('/api/events/' + eventId + '/teams', { name: 'Équipe 1', color: '#e63946' })).json();
    const validated = (await points()).find((p) => p.origin === 'suggestion')!;
    expect((await orga.post('/api/teams/' + team.id + '/missions', { pointId: validated.id })).statusCode).toBe(201);

    // OSM a évolué : la rue D (way 4) devient à double sens, et une nouvelle rue apparaît à x=150 ;
    // le nœud de la voie privée (7) est renuméroté.
    const data: OverpassResponse = structuredClone(referenceNetwork());
    for (const el of data.elements) {
      if (el.type === 'way' && el.id === 4) delete el.tags!.oneway;
    }
    data.elements.push({ type: 'node', id: 90, lat: at(150, 0)[1], lon: at(150, 0)[0] });
    data.elements.push({ type: 'node', id: 91, lat: at(150, 100)[1], lon: at(150, 100)[0] });
    data.elements.push({ type: 'way', id: 9, nodes: [90, 91], tags: { highway: 'residential', name: 'Rue Nouvelle' } });
    const wayA = data.elements.find((e) => e.type === 'way' && e.id === 1)!;
    if (wayA.type === 'way') wayA.nodes = [1, 2, 3, 90, 4, 5, 6, 777, 8];
    const node7 = data.elements.find((e) => e.type === 'node' && e.id === 7)!;
    node7.id = 777;
    const way8 = data.elements.find((e) => e.type === 'way' && e.id === 8)!;
    if (way8.type === 'way') way8.nodes = [777, 80];
    ctx.osm.data = data;

    const r = await orga.post('/api/events/' + eventId + '/analyses', {});
    expect(r.statusCode).toBe(201);
    const m = r.json().merge;
    expect(m.added.map((a: { stableKey: string }) => a.stableKey)).toEqual(['osm:n90']);
    expect(m.ignoredDismissed.map((a: { stableKey: string }) => a.stableKey)).toEqual(['osm:n2']);
    expect(m.modified.map((a: { stableKey: string }) => a.stableKey)).toEqual(['osm:n5']);
    // Le nœud renuméroté est reconnu par sa voie et sa position : pas de doublon.
    expect(m.alreadyPresent.map((a: { stableKey: string }) => a.stableKey)).toContain('osm:n7');
    expect(m.missing).toEqual([]);

    const list = await suggestions();
    expect(list).toHaveLength(7);
    expect(list.filter((s) => s.stableKey === 'osm:n2')[0]!.status).toBe('ecartee');
    expect((await byKey('osm:n3')).status).toBe('validee');
    expect((await byKey('osm:n5')).pendingUpdate).not.toBeNull();
    // Le point manuel et l'affectation sont intacts.
    const pts = await points();
    expect(pts.find((p) => p.id === manual.id)).toBeTruthy();
    expect(pts.find((p) => p.id === validated.id)!.status).toBe('affecte');
    const teams = (await orga.get('/api/events/' + eventId + '/teams')).json();
    expect(teams[0].missions).toHaveLength(1);
  });

  it('applique une modification OSM en attente sans toucher au statut', async () => {
    const s = await byKey('osm:n5');
    expect((await orga.post('/api/suggestions/' + s.id + '/pending', { action: 'appliquer' })).statusCode).toBe(200);
    const after = await byKey('osm:n5');
    expect(after.pendingUpdate).toBeNull();
    expect(after.status).toBe('a_examiner');
    expect(after.type).toBe('acces_vehicule_entrant');
  });

  it('signale une suggestion proche d\'un point existant (doublon possible)', async () => {
    const data = structuredClone(ctx.osm.data);
    data.elements.push({ type: 'node', id: 95, lat: at(410, 0)[1], lon: at(410, 0)[0] });
    data.elements.push({ type: 'node', id: 96, lat: at(410, -100)[1], lon: at(410, -100)[0] });
    data.elements.push({ type: 'way', id: 10, nodes: [95, 96], tags: { highway: 'residential', name: 'Impasse' } });
    const wayA = data.elements.find((e) => e.type === 'way' && e.id === 1)!;
    if (wayA.type === 'way') wayA.nodes = [1, 2, 3, 90, 4, 5, 6, 95, 777, 8];
    ctx.osm.data = data;
    const m = (await orga.post('/api/events/' + eventId + '/analyses', {})).json().merge;
    expect(m.added).toHaveLength(1);
    expect(m.added[0].duplicateOfPoint).toMatchObject({ name: 'Point manuel' });
  });

  it("signale l'indisponibilité d'Overpass sans rien modifier", async () => {
    const before = (await suggestions()).length;
    ctx.osm.fail = new Error('Serveur Overpass saturé (HTTP 429)');
    const r = await orga.post('/api/events/' + eventId + '/analyses', {});
    ctx.osm.fail = null;
    expect(r.statusCode).toBe(502);
    expect((await suggestions()).length).toBe(before);
  });
});

describe('points de mission', () => {
  it('ajoute un point par coordonnées et calcule sa distance cumulée', async () => {
    const r = await orga.post('/api/events/' + eventId + '/points', { name: 'Angle', type: 'carrefour', position: at(250, 20) });
    expect(r.statusCode).toBe(201);
    expect(r.json().distance).toBeCloseTo(250, -1);
    expect(r.json().origin).toBe('manuel');
    // Coordonnées invalides refusées.
    expect((await orga.post('/api/events/' + eventId + '/points', { name: 'X', position: [200, 95] })).statusCode).toBe(400);
  });

  it('déplace et modifie un point, avec verrou optimiste et historique', async () => {
    const p = (await points('?q=Angle'))[0]!;
    const r = await orga.patch('/api/points/' + p.id, { version: p.version, position: at(300, 10), name: 'Angle rue D' });
    expect(r.statusCode).toBe(200);
    expect(r.json().distance).toBeCloseTo(300, -1);
    // Version périmée : conflit.
    expect((await orga.patch('/api/points/' + p.id, { version: p.version, name: 'Autre' })).statusCode).toBe(409);
    // Distance fixée à la main.
    const locked = await orga.patch('/api/points/' + p.id, { version: r.json().version, distance: 290 });
    expect(locked.json()).toMatchObject({ distance: 290, distanceLocked: true });
    const h = (await orga.get('/api/points/' + p.id + '/history')).json();
    expect(h.map((x: { action: string }) => x.action)).toEqual(['modification', 'deplacement', 'creation']);
  });

  it('filtre et recherche les points', async () => {
    expect((await points('?q=manuel')).map((p) => p.name)).toEqual(['Point manuel']);
    expect((await points('?status=affecte'))).toHaveLength(1);
    expect((await points('?q=%25'))).toHaveLength(0);
  });

  it('suppression avec dépendances : conséquences puis confirmation', async () => {
    const p = (await points('?status=affecte'))[0]!;
    const first = await orga.delete('/api/points/' + p.id);
    expect(first.statusCode).toBe(409);
    expect(first.json().details.missions).toHaveLength(1);
    expect(first.json().details.suggestion).toBeTruthy();
    expect((await points()).some((x) => x.id === p.id)).toBe(true);
    const ok = await orga.delete('/api/points/' + p.id + '?confirm=1');
    expect(ok.statusCode).toBe(200);
    expect((await points()).some((x) => x.id === p.id)).toBe(false);
    // La suggestion d'origine est écartée : elle ne réapparaîtra pas.
    expect((await byKey('osm:n3')).status).toBe('ecartee');
    const m = (await orga.post('/api/events/' + eventId + '/analyses', {})).json().merge;
    expect(m.ignoredDismissed.map((x: { stableKey: string }) => x.stableKey)).toContain('osm:n3');
    expect(m.added).toEqual([]);
  });

  it('supprime sans confirmation un point sans dépendance', async () => {
    const p = (await orga.post('/api/events/' + eventId + '/points', { name: 'Éphémère', position: at(10, 0) })).json();
    expect((await orga.delete('/api/points/' + p.id)).statusCode).toBe(200);
  });
});

describe('remplacement du GPX', () => {
  it("prévient quand des points s'éloignent du nouveau tracé, sans rien supprimer", async () => {
    const before = await points();
    const gpx = gpxFrom([[[0, 3], [250, -2], [300, 0], [300, 400]]], 'Variante');
    const preview = await orga.upload('/api/events/' + eventId + '/tracks?preview=1', gpx);
    expect(preview.statusCode).toBe(200);
    expect(preview.json().impact.map((i: { name: string }) => i.name)).toContain('Point manuel');
    const refused = await orga.upload('/api/events/' + eventId + '/tracks', gpx);
    expect(refused.statusCode).toBe(409);
    const ok = await orga.upload('/api/events/' + eventId + '/tracks?confirm=1', gpx);
    expect(ok.statusCode).toBe(201);
    expect(ok.json().version).toBe(2);
    const after = await points();
    expect(after.map((p) => p.id).sort()).toEqual(before.map((p) => p.id).sort());
    const versions = (await orga.get('/api/events/' + eventId + '/tracks')).json();
    expect(versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    const summary = (await orga.get('/api/events/' + eventId + '/summary')).json();
    expect(summary.lastAnalysis.outdated).toBe(true);
  });
});
