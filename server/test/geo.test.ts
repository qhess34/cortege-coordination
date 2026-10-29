import { describe, expect, it } from 'vitest';
import { GpxError, parseGpx } from '../src/geo/gpx.js';
import { analyse, motorAccess, onewayDirection } from '../src/geo/osm-analysis.js';
import { Route, haversine, simplify } from '../src/geo/route.js';
import { OsmBuilder, at, gpxFrom, referenceNetwork } from './helpers/osm.js';

/** Mode « un point par carrefour » (option), testé ici avec les rues sortantes. */
const CLUSTER = { perAccess: false, includeOutgoing: true };

describe('distances', () => {
  it('haversine : un degré de latitude ≈ 111,2 km', () => {
    expect(haversine([2, 48], [2, 49])).toBeCloseTo(111195, -1);
  });

  it('longueur, distances cumulées et point à une distance', () => {
    const r = new Route([[at(0, 0), at(300, 0), at(300, 400)]]);
    expect(r.length).toBeCloseTo(700, 0);
    const pr = r.locate(at(300, 100))!;
    expect(pr.distance).toBeCloseTo(400, 0);
    expect(pr.offset).toBeLessThan(0.5);
    expect(haversine(r.pointAt(500)!, at(300, 200))).toBeLessThan(0.5);
  });

  it('passages multiples sur une boucle aller-retour', () => {
    const r = new Route([[at(0, 0), at(400, 0), at(400, 10), at(0, 10)]]);
    const ps = r.passages(at(200, 5), 15);
    expect(ps).toHaveLength(2);
    expect(ps[0]!.distance).toBeCloseTo(200, 0);
    expect(ps[1]!.distance).toBeCloseTo(610, 0);
  });

  it('simplification Douglas-Peucker', () => {
    const line = [at(0, 0), at(50, 0.5), at(100, 0), at(100, 100)];
    expect(simplify(line, 2)).toHaveLength(3);
  });
});

describe('import GPX', () => {
  it('lit un GPX valide, sa longueur et ses points de passage', () => {
    const g = parseGpx(gpxFrom([[[0, 0], [250, 0], [500, 0]]], 'Défilé', [{ name: 'Départ', x: 0, y: 5 }]));
    expect(g.name).toBe('Défilé');
    expect(g.segments).toHaveLength(1);
    expect(g.length).toBeCloseTo(500, 0);
    expect(g.closed).toBe(false);
    expect(g.waypoints[0]).toMatchObject({ name: 'Départ' });
    expect(g.waypoints[0]!.distance).toBeCloseTo(0, 0);
    expect(g.warnings).toEqual([]);
  });

  it('détecte une boucle fermée', () => {
    const g = parseGpx(gpxFrom([[[0, 0], [300, 0], [300, 300], [0, 300], [0, 10]]]));
    expect(g.closed).toBe(true);
  });

  it('signale les segments disjoints et les sauts', () => {
    const g = parseGpx(gpxFrom([[[0, 0], [100, 0]], [[400, 0], [500, 0], [1500, 0]]]));
    expect(g.segments).toHaveLength(2);
    expect(g.length).toBeCloseTo(1200, 0);
    expect(g.warnings.some((w) => w.includes('Segments disjoints'))).toBe(true);
    expect(g.warnings.some((w) => w.includes('Saut de 1000 m'))).toBe(true);
  });

  it('refuse un fichier invalide', () => {
    expect(() => parseGpx('ceci n\'est pas du XML <')).toThrow(GpxError);
    expect(() => parseGpx('<?xml version="1.0"?><kml></kml>')).toThrow(/pas un GPX/);
    expect(() => parseGpx('<?xml version="1.0"?><gpx version="1.1"><trk><trkseg><trkpt lat="48" lon="2"/></trkseg></trk></gpx>')).toThrow(/Aucune trace/);
  });

  it('ignore les coordonnées hors limites', () => {
    const xml = '<?xml version="1.0"?><gpx version="1.1"><trk><trkseg><trkpt lat="48.85" lon="2.35"/><trkpt lat="95" lon="2.35"/><trkpt lat="48.851" lon="2.35"/></trkseg></trk></gpx>';
    const g = parseGpx(xml);
    expect(g.segments[0]).toHaveLength(2);
    expect(g.warnings.some((w) => w.includes('invalides'))).toBe(true);
  });
});

describe('attributs OSM', () => {
  it('sens uniques, y compris inversés et implicites', () => {
    expect(onewayDirection({ oneway: 'yes' })).toBe(1);
    expect(onewayDirection({ oneway: '-1' })).toBe(-1);
    expect(onewayDirection({ oneway: 'reverse' })).toBe(-1);
    expect(onewayDirection({ oneway: 'reversible' })).toBeNull();
    expect(onewayDirection({ junction: 'roundabout' })).toBe(1);
    expect(onewayDirection({ junction: 'roundabout', oneway: 'no' })).toBe(0);
    expect(onewayDirection({ highway: 'residential' })).toBe(0);
    expect(onewayDirection({ oneway: 'yes', 'oneway:motor_vehicle': 'no' })).toBe(0);
  });

  it('accès motorisé : la clé la plus spécifique l\'emporte', () => {
    expect(motorAccess({ highway: 'residential' }, [])).toBe('oui');
    expect(motorAccess({ highway: 'footway' }, [])).toBe('non');
    // Voie piétonne ou cyclable : seules motor_vehicle / motorcar comptent pour les véhicules à moteur.
    const livraisons: string[] = [];
    expect(motorAccess({ highway: 'pedestrian', motor_vehicle: 'delivery' }, livraisons)).toBe('non');
    expect(livraisons[0]).toMatch(/livraisons/);
    expect(motorAccess({ highway: 'footway', access: 'yes' }, [])).toBe('non');
    expect(motorAccess({ highway: 'path', access: 'permissive' }, [])).toBe('non');
    expect(motorAccess({ highway: 'cycleway', vehicle: 'yes' }, [])).toBe('non');
    expect(motorAccess({ highway: 'cycleway', access: 'destination' }, [])).toBe('non');
    expect(motorAccess({ highway: 'pedestrian', motor_vehicle: 'yes' }, [])).toBe('oui');
    expect(motorAccess({ highway: 'service', access: 'private' }, [])).toBe('prive');
    expect(motorAccess({ highway: 'residential', access: 'no', motor_vehicle: 'destination' }, [])).toBe('limite');
    const unc: string[] = [];
    expect(motorAccess({ highway: 'residential', 'motor_vehicle:conditional': 'no @ (Sa 08:00-13:00)' }, unc)).toBe('oui');
    expect(unc[0]).toMatch(/Restriction temporelle/);
  });
});

describe('analyse du réseau', () => {
  const route = new Route([[at(0, 3), at(250, -2), at(500, 2)]]);
  const result = analyse(route, referenceNetwork(), CLUSTER);
  const byKey = (k: string) => result.suggestions.find((s) => s.stableKey === k);

  it('détecte les intersections réelles et leur type', () => {
    expect(result.suggestions.map((s) => [s.stableKey, s.type])).toEqual([
      ['osm:n2', 'acces_pieton_cycle'],
      ['osm:n3', 'carrefour'],
      ['osm:n4', 'rue_laterale'],
      ['osm:x1-6', 'verification'],
      ['osm:n5', 'acces_vehicule_entrant'],
      ['osm:n7', 'voie_privee'],
    ]);
  });

  it('calcule la distance cumulée et explique la détection', () => {
    const c = byKey('osm:n3')!;
    expect(c.distance).toBeCloseTo(100, -1);
    expect(c.routeNames).toEqual(['Rue A']);
    expect(c.branches).toHaveLength(1);
    expect(c.branches[0]).toMatchObject({ wayId: 2, name: 'Rue B', flow: 'double_sens', motor: 'oui' });
    expect(c.reasons.join(' ')).toMatch(/Rue B/);
    expect(c.restrictions).toEqual([expect.objectContaining({ restriction: 'no_left_turn' })]);
  });

  it('tient compte des sens uniques sans écarter le point', () => {
    expect(byKey('osm:n4')!.branches[0]!.flow).toBe('sortant');
    expect(byKey('osm:n4')!.pertinence).toBe('faible');
    expect(byKey('osm:n5')!.branches[0]!.flow).toBe('entrant');
    expect(byKey('osm:n5')!.pertinence).toBe('moyenne');
  });

  it('ne connecte pas un pont qui croise le parcours', () => {
    expect(result.suggestions.some((s) => s.branches.some((b) => b.wayId === 5))).toBe(false);
    expect(result.ignoredCrossings).toEqual([expect.objectContaining({ wayIds: [1, 5] })]);
  });

  it('signale un croisement sans nœud ni pont comme donnée incertaine', () => {
    expect(byKey('osm:x1-6')!.uncertainties.join(' ')).toMatch(/incomplètes/);
  });

  it('reconnaît tout le parcours sur les voies OSM', () => {
    expect(result.coverage).toBeGreaterThan(0.95);
    expect(result.unmatched).toEqual([]);
    expect(result.osmTimestamp).toBe('2026-10-01T00:00:00Z');
  });

  it('peut exclure les accès non motorisés', () => {
    const r = analyse(route, referenceNetwork(), { ...CLUSTER, includeNonMotor: false });
    expect(r.suggestions.some((s) => s.type === 'acces_pieton_cycle')).toBe(false);
  });

  it('peut exclure les rues sortantes, sans toucher aux carrefours ni aux accès entrants', () => {
    const r = analyse(route, referenceNetwork(), { ...CLUSTER, includeOutgoing: false });
    expect(r.suggestions.some((s) => s.type === 'rue_laterale')).toBe(false);
    expect(r.suggestions.map((s) => s.stableKey)).toEqual(['osm:n2', 'osm:n3', 'osm:x1-6', 'osm:n5', 'osm:n7']);
  });

  it('sens unique inversé (oneway=-1) : arrive sur le parcours', () => {
    const b = new OsmBuilder();
    b.node(1, 0, 0); b.node(2, 100, 0); b.node(3, 200, 0); b.node(4, 100, 100);
    b.way(1, [1, 2, 3], { highway: 'residential', name: 'Rue A' });
    b.way(2, [2, 4], { highway: 'residential', name: 'Rue E', oneway: '-1' });
    const r = analyse(new Route([[at(0, 0), at(200, 0)]]), b.build(), CLUSTER);
    expect(r.suggestions[0]).toMatchObject({ type: 'acces_vehicule_entrant' });
    expect(r.suggestions[0]!.branches[0]!.flow).toBe('entrant');
  });

  it('regroupe les nœuds d\'un même carrefour (trottoir parallèle + chaussée)', () => {
    const b = new OsmBuilder();
    b.node(1, 0, 0); b.node(2, 100, 0); b.node(3, 200, 0);
    b.way(1, [1, 2, 3], { highway: 'residential', name: 'Rue A' });
    b.node(10, 0, 8); b.node(11, 100, 8); b.node(12, 200, 8);
    b.way(10, [10, 11, 12], { highway: 'footway', footway: 'sidewalk' });
    b.node(20, 100, 100);
    b.way(2, [2, 11, 20], { highway: 'residential', name: 'Rue F' });
    const r = analyse(new Route([[at(0, 0), at(200, 0)]]), b.build(), CLUSTER);
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0]).toMatchObject({ stableKey: 'osm:n2', type: 'acces_vehicule_entrant' });
    expect(r.suggestions[0]!.nodeIds.sort()).toEqual([11, 2]);
  });

  it('virage du parcours : la continuation de la rue est une branche', () => {
    const b = new OsmBuilder();
    b.node(1, 0, 0); b.node(2, 100, 0); b.node(3, 200, 0); b.node(4, 100, 100);
    b.way(1, [1, 2, 3], { highway: 'residential', name: 'Rue A' });
    b.way(2, [2, 4], { highway: 'residential', name: 'Rue G' });
    // Le parcours suit la rue A puis tourne dans la rue G.
    const r = analyse(new Route([[at(0, 0), at(100, 0), at(100, 100)]]), b.build(), CLUSTER);
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0]!.branches.map((x) => x.wayId)).toEqual([1]);
    expect(r.suggestions[0]!.routeNames.sort()).toEqual(['Rue A', 'Rue G']);
  });

  it('boucle : un carrefour traversé deux fois le signale', () => {
    const b = new OsmBuilder();
    b.node(1, 0, 0); b.node(2, 200, 0); b.node(3, 400, 0); b.node(4, 200, 100);
    b.way(1, [1, 2, 3], { highway: 'residential', name: 'Rue A' });
    b.way(2, [2, 4], { highway: 'residential', name: 'Rue H' });
    const r = analyse(new Route([[at(0, 0), at(400, 0), at(400, 2), at(0, 2)]]), b.build(), CLUSTER);
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0]!.passages).toHaveLength(2);
    expect(r.suggestions[0]!.uncertainties.join(' ')).toMatch(/passe 2 fois/);
  });

  it('signale les portions du parcours sans voie OSM', () => {
    const b = new OsmBuilder();
    b.node(1, 0, 0); b.node(2, 200, 0);
    b.way(1, [1, 2], { highway: 'residential' });
    const r = analyse(new Route([[at(0, 0), at(200, 0), at(400, 0)]]), b.build(), CLUSTER);
    expect(r.unmatched).toHaveLength(1);
    expect(r.unmatched[0]![0]).toBeGreaterThan(190);
    expect(r.coverage).toBeLessThan(0.6);
  });
});

describe('sens de circulation non précisé', () => {
  it("une voie sans « oneway » est à double sens, sans incertitude", () => {
    const b = new OsmBuilder();
    b.node(1, 0, 0); b.node(2, 100, 0); b.node(3, 200, 0); b.node(4, 100, 100);
    b.way(1, [1, 2, 3], { highway: 'residential', name: 'Rue A' });
    b.way(2, [2, 4], { highway: 'primary', name: 'Avenue sans sens indiqué' });
    const r = analyse(new Route([[at(0, 0), at(200, 0)]]), b.build(), CLUSTER);
    expect(r.suggestions[0]!.branches[0]!.flow).toBe('double_sens');
    expect(r.suggestions[0]!.uncertainties.join(' ')).not.toMatch(/sens/i);
    expect(r.suggestions[0]!.type).toBe('acces_vehicule_entrant');
  });
});

describe('un point par accès entrant (mode par défaut)', () => {
  const route = new Route([[at(0, 3), at(250, -2), at(500, 2)]]);
  const r = analyse(route, referenceNetwork());
  const get = (k: string) => r.suggestions.find((s) => s.stableKey === k)!;

  it("propose un point par côté d'où l'on peut arriver, et aucun pour une rue sortante", () => {
    expect(r.suggestions.map((s) => [s.stableKey, s.type])).toEqual([
      ['osm:n2-n70', 'acces_pieton_cycle'],
      ['osm:n3-n20', 'acces_vehicule_entrant'],
      ['osm:n3-n21', 'acces_vehicule_entrant'],
      ['osm:x1-6', 'verification'],
      ['osm:n5-n40', 'acces_vehicule_entrant'],
      ['osm:n7-n80', 'voie_privee'],
    ]);
  });

  it('place chaque point dans la voie, à 20 m du carrefour, avec son côté', () => {
    const sud = get('osm:n3-n20');
    const nord = get('osm:n3-n21');
    expect(haversine(sud.position, at(100, 0))).toBeCloseTo(20, 0);
    expect(haversine(nord.position, at(100, 0))).toBeCloseTo(20, 0);
    expect(sud.junction).toMatchObject({ nodeId: 3, side: 'sud', accesses: 2 });
    expect(nord.junction!.side).toBe('nord');
    expect(nord.branches).toEqual([expect.objectContaining({ name: 'Rue B', flow: 'double_sens' })]);
    expect(nord.distance).toBeCloseTo(100, -1);
    expect(nord.reasons.join(' ')).toMatch(/Côté nord du carrefour Rue A \/ Rue B/);
    expect(nord.restrictions).toHaveLength(1);
  });

  it('rues sortantes en option', () => {
    const avec = analyse(route, referenceNetwork(), { includeOutgoing: true });
    expect(avec.suggestions.find((s) => s.stableKey === 'osm:n4-n30')).toMatchObject({ type: 'rue_laterale' });
  });

  it('voie à sens unique qui traverse le parcours : un seul accès entrant', () => {
    const b = new OsmBuilder();
    b.node(1, 0, 0); b.node(2, 100, 0); b.node(3, 200, 0); b.node(4, 100, -80); b.node(5, 100, 80);
    b.way(1, [1, 2, 3], { highway: 'residential', name: 'Rue A' });
    b.way(2, [4, 2, 5], { highway: 'residential', name: 'Rue S', oneway: 'yes' }); // du sud vers le nord
    const res = analyse(new Route([[at(0, 0), at(200, 0)]]), b.build());
    expect(res.suggestions.map((s) => [s.stableKey, s.junction?.side])).toEqual([['osm:n2-n4', 'sud']]);
  });

  it('voie plus courte que 20 m : le point est à son extrémité', () => {
    const b = new OsmBuilder();
    b.node(1, 0, 0); b.node(2, 100, 0); b.node(3, 200, 0); b.node(4, 100, 8);
    b.way(1, [1, 2, 3], { highway: 'residential', name: 'Rue A' });
    b.way(2, [2, 4], { highway: 'service', name: 'Cour' });
    const res = analyse(new Route([[at(0, 0), at(200, 0)]]), b.build(), { routeTolerance: 5 });
    expect(haversine(res.suggestions[0]!.position, at(100, 8))).toBeLessThan(0.5);
    expect(res.suggestions[0]!.pertinence).toBe('faible');
  });
});

describe('accès piétons et cyclables exclus', () => {
  it("aucune suggestion sur un chemin, une piste cyclable ou une zone piétonne quand l'option est décochée", () => {
    const b = new OsmBuilder();
    b.node(1, 0, 0); b.node(2, 100, 0); b.node(3, 200, 0); b.node(4, 300, 0); b.node(5, 400, 0);
    b.way(1, [1, 2, 3, 4, 5], { highway: 'residential', name: 'Rue A' });
    b.node(10, 100, 60); b.way(10, [2, 10], { highway: 'footway', access: 'yes' });
    b.node(11, 200, 60); b.way(11, [3, 11], { highway: 'cycleway', vehicle: 'yes' });
    b.node(12, 300, 60); b.way(12, [4, 12], { highway: 'pedestrian', name: 'Place', motor_vehicle: 'delivery' });
    b.node(13, 250, -40); b.node(14, 250, 40); b.way(13, [13, 14], { highway: 'path', access: 'permissive' }); // croise sans nœud
    const route = new Route([[at(0, 0), at(400, 0)]]);
    expect(analyse(route, b.build(), { includeNonMotor: false }).suggestions).toEqual([]);
    const avec = analyse(route, b.build());
    expect(avec.suggestions.filter((s) => s.type === 'acces_pieton_cycle').length).toBe(3);
  });
});
