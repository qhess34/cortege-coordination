// Analyse du réseau viaire OSM autour du parcours. Module pur : prend la réponse Overpass (JSON) et le parcours,
// renvoie des suggestions explicables. Aucune suggestion n'est une garantie : ce sont des points à examiner.
import { Route, axisDifference, bearing, haversine, projectOnSegment, type Position } from './route.js';

// --- Données OSM ---------------------------------------------------------------------------------------------

export type Tags = Record<string, string>;
export interface OsmNode { type: 'node'; id: number; lat: number; lon: number; tags?: Tags }
export interface OsmWay { type: 'way'; id: number; nodes: number[]; tags?: Tags }
export interface OsmRelation {
  type: 'relation';
  id: number;
  members: { type: 'node' | 'way' | 'relation'; ref: number; role: string }[];
  tags?: Tags;
}
export type OsmElement = OsmNode | OsmWay | OsmRelation;
export interface OverpassResponse { osm3s?: { timestamp_osm_base?: string }; elements: OsmElement[] }

// --- Résultat ------------------------------------------------------------------------------------------------

export type SuggestionType =
  | 'carrefour'
  | 'rue_laterale'
  | 'acces_vehicule_entrant'
  | 'acces_pieton_cycle'
  | 'voie_privee'
  | 'verification';

/** Sens de circulation possible sur la branche, vu depuis le point de connexion. */
export type Flow = 'entrant' | 'sortant' | 'double_sens' | 'variable';
/** Accès des véhicules motorisés sur la branche. */
export type MotorAccess = 'oui' | 'limite' | 'prive' | 'non' | 'incertain';

export interface Branch {
  wayId: number;
  name: string | null;
  highway: string;
  flow: Flow;
  motor: MotorAccess;
  /** La voie traverse le parcours (une branche de chaque côté). */
  crossing: boolean;
  /** Attributs OSM utiles de la voie (sous-ensemble). */
  tags: Tags;
}

export interface Restriction { relationId: number; restriction: string; from: number[]; to: number[] }

export interface Suggestion {
  stableKey: string;
  type: SuggestionType;
  pertinence: 'elevee' | 'moyenne' | 'faible';
  position: Position;
  /** Distance cumulée du premier passage (m). */
  distance: number;
  /** Toutes les distances cumulées si le parcours passe plusieurs fois (boucle, aller-retour). */
  passages: number[];
  routeNames: string[];
  branches: Branch[];
  restrictions: Restriction[];
  nodeIds: number[];
  reasons: string[];
  uncertainties: string[];
}

export interface IgnoredCrossing { wayIds: [number, number]; position: Position; distance: number; reason: string }

export interface AnalysisResult {
  suggestions: Suggestion[];
  /** Croisements géométriques sans connexion (ponts, tunnels…), non proposés. */
  ignoredCrossings: IgnoredCrossing[];
  /** Portions du parcours qui ne longent aucune voie OSM connue : [début, fin] en m. */
  unmatched: [number, number][];
  coverage: number;
  osmTimestamp: string | null;
  stats: { ways: number; nodes: number; routeEdges: number; candidates: number };
}

export interface AnalysisOptions {
  /** Distance max (m) entre une voie et le tracé pour la considérer comme portée par le parcours. */
  routeTolerance: number;
  /** Écart angulaire max (°) entre une voie et le tracé pour la considérer comme portée par le parcours. */
  maxAngle: number;
  /** Rayon (m) de regroupement des connexions proches (grands carrefours, trottoirs, passages piétons). */
  clusterRadius: number;
  /** Inclure les connexions uniquement piétonnes ou cyclables. */
  includeNonMotor: boolean;
}

export const DEFAULT_OPTIONS: AnalysisOptions = {
  routeTolerance: 15,
  maxAngle: 35,
  clusterRadius: 25,
  includeNonMotor: true,
};

// --- Classement des voies ------------------------------------------------------------------------------------

const MOTOR_HIGHWAYS = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street',
  'service', 'road', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link', 'track',
]);
const MAJOR_HIGHWAYS = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'motorway_link', 'trunk_link', 'primary_link',
  'secondary_link', 'tertiary_link',
]);
const NON_MOTOR_HIGHWAYS = new Set([
  'footway', 'path', 'cycleway', 'steps', 'bridleway', 'pedestrian', 'corridor', 'elevator', 'sidewalk', 'crossing',
]);
const UNCERTAIN_HIGHWAYS = new Set(['construction', 'proposed', 'road', 'busway', 'bus_guideway']);
/** Valeurs qui n'existent pas comme voies du réseau. */
const IGNORED_HIGHWAYS = new Set(['platform', 'rest_area', 'services', 'abandoned', 'razed', 'raceway', 'escape']);

const YES = new Set(['yes', 'permissive', 'designated', 'official']);
const LIMITED = new Set(['destination', 'delivery', 'customers', 'agricultural', 'forestry', 'permit', 'discouraged']);
const PRIVATE = new Set(['private']);
const NO = new Set(['no', 'use_sidepath', 'dismount']);

/** Attributs conservés pour l'affichage (le reste est rarement utile pour l'encadrement). */
const USEFUL_KEYS = /^(highway|name|ref|oneway(:.+)?|junction|access|vehicle|motor_vehicle|motorcar|motorcycle|hgv|bus|psv|bicycle|foot|service|bridge|tunnel|layer|covered|maxspeed|lanes|surface|barrier|fixme|FIXME|note|construction|.+:conditional|sidewalk|footway|cycleway)$/;

function usefulTags(tags: Tags): Tags {
  const out: Tags = {};
  for (const [k, v] of Object.entries(tags)) if (USEFUL_KEYS.test(k)) out[k] = v;
  return out;
}

/** Accès motorisé : la clé la plus spécifique l'emporte (motorcar > motor_vehicle > vehicle > access). */
export function motorAccess(tags: Tags, uncertainties: string[]): MotorAccess {
  const hw = tags.highway ?? '';
  for (const k of ['access', 'vehicle', 'motor_vehicle', 'motorcar']) {
    if (tags[k + ':conditional']) {
      uncertainties.push('Restriction temporelle ' + k + ':conditional=' + tags[k + ':conditional'] + ' : vérifier les horaires.');
    }
  }
  const value = tags.motorcar ?? tags.motor_vehicle ?? tags.vehicle ?? tags.access;
  let base: MotorAccess;
  if (MOTOR_HIGHWAYS.has(hw)) base = 'oui';
  else if (NON_MOTOR_HIGHWAYS.has(hw)) base = 'non';
  else base = 'incertain';
  if (value === undefined) {
    if (hw === 'track') return 'limite';
    return base;
  }
  if (YES.has(value)) return 'oui';
  if (LIMITED.has(value)) return 'limite';
  if (PRIVATE.has(value)) return 'prive';
  if (NO.has(value)) return 'non';
  uncertainties.push('Valeur d\'accès inhabituelle : ' + value + '.');
  return 'incertain';
}

/** Sens unique : +1 dans le sens des nœuds, -1 en sens inverse, 0 double sens, null variable. */
export function onewayDirection(tags: Tags): 1 | -1 | 0 | null {
  const v = tags['oneway:motor_vehicle'] ?? tags.oneway;
  if (v === 'yes' || v === '1' || v === 'true') return 1;
  if (v === '-1' || v === 'reverse') return -1;
  if (v === 'reversible' || v === 'alternating') return null;
  if (v === 'no' || v === 'false' || v === '0') return 0;
  if (tags.junction === 'roundabout' || tags.junction === 'circular') return 1;
  if (tags.highway === 'motorway' || tags.highway === 'motorway_link') return 1;
  return 0;
}

function isElevated(tags: Tags): boolean {
  return (
    (tags.bridge !== undefined && tags.bridge !== 'no') ||
    (tags.tunnel !== undefined && tags.tunnel !== 'no') ||
    (tags.covered !== undefined && tags.covered !== 'no')
  );
}
const layer = (t: Tags) => Number.parseInt(t.layer ?? '0', 10) || 0;

// --- Analyse -------------------------------------------------------------------------------------------------

interface Edge { way: OsmWay; a: number; b: number; onRoute: boolean }

/** Intersection de deux segments en coordonnées locales (approximation plane suffisante à l'échelle d'une rue). */
function segmentIntersection(p1: Position, p2: Position, q1: Position, q2: Position): Position | null {
  const k = Math.cos((p1[1] * Math.PI) / 180);
  const x = (p: Position) => p[0] * k;
  const d = (x(p2) - x(p1)) * (q2[1] - q1[1]) - (p2[1] - p1[1]) * (x(q2) - x(q1));
  if (d === 0) return null;
  const t = ((x(q1) - x(p1)) * (q2[1] - q1[1]) - (q1[1] - p1[1]) * (x(q2) - x(q1))) / d;
  const u = ((x(q1) - x(p1)) * (p2[1] - p1[1]) - (q1[1] - p1[1]) * (x(p2) - x(p1))) / d;
  const eps = 1e-9;
  if (t <= eps || t >= 1 - eps || u <= eps || u >= 1 - eps) return null;
  return [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])];
}

function describeBranch(b: Branch): string {
  const name = b.name ? b.name : 'voie sans nom';
  const flow = {
    entrant: 'sens unique vers le parcours',
    sortant: 'sens unique depuis le parcours',
    double_sens: 'double sens',
    variable: 'sens variable',
  }[b.flow];
  const motor = {
    oui: 'ouverte aux véhicules',
    limite: 'accès véhicules limité',
    prive: 'voie privée',
    non: 'non motorisée',
    incertain: 'accès incertain',
  }[b.motor];
  return name + ' (' + b.highway + ', ' + motor + (b.motor === 'non' ? '' : ', ' + flow) + ', voie OSM ' + b.wayId + ')';
}

export function analyse(
  route: Route,
  data: OverpassResponse,
  options: Partial<AnalysisOptions> = {},
): AnalysisResult {
  const opt = { ...DEFAULT_OPTIONS, ...options };
  const nodes = new Map<number, Position>();
  const ways: OsmWay[] = [];
  const relations: OsmRelation[] = [];
  for (const el of data.elements) {
    if (el.type === 'node') nodes.set(el.id, [el.lon, el.lat]);
    else if (el.type === 'way') {
      const hw = el.tags?.highway;
      if (hw && !IGNORED_HIGHWAYS.has(hw)) ways.push(el);
    } else if (el.type === 'relation') relations.push(el);
  }

  // 1. Arêtes du réseau et reconnaissance de celles qui sont portées par le parcours.
  const edges: Edge[] = [];
  const byNode = new Map<number, Edge[]>();
  for (const way of ways) {
    for (let i = 0; i < way.nodes.length - 1; i++) {
      const a = way.nodes[i]!;
      const b = way.nodes[i + 1]!;
      const pa = nodes.get(a);
      const pb = nodes.get(b);
      if (!pa || !pb) continue;
      const e: Edge = { way, a, b, onRoute: isOnRoute(route, pa, pb, opt) };
      edges.push(e);
      for (const n of [a, b]) {
        const list = byNode.get(n);
        if (list) list.push(e);
        else byNode.set(n, [e]);
      }
    }
  }
  const routeEdges = edges.filter((e) => e.onRoute);

  // 2. Connexions réelles : nœuds partagés entre une arête du parcours et une arête qui n'en fait pas partie.
  interface Candidate { node: number; position: Position; distance: number; offset: number; branches: Edge[]; onRouteWays: OsmWay[] }
  const candidates: Candidate[] = [];
  for (const [node, list] of byNode) {
    const on = list.filter((e) => e.onRoute);
    if (!on.length) continue;
    const pos = nodes.get(node)!;
    const pr = route.locate(pos);
    if (!pr || pr.offset > opt.routeTolerance) continue;
    // Une arête mal alignée d'une voie du parcours (tracé imprécis dans un virage) qui reste près du tracé
    // est la continuation du parcours, pas une branche.
    const onWays = new Set(on.map((e) => e.way.id));
    const off = list.filter((e) => {
      if (e.onRoute) return false;
      if (!onWays.has(e.way.id)) return true;
      const far = route.locate(nodes.get(e.a === node ? e.b : e.a)!);
      return !far || far.offset > 2 * opt.routeTolerance;
    });
    if (!off.length) continue;
    candidates.push({ node, position: pos, distance: pr.distance, offset: pr.offset, branches: off, onRouteWays: on.map((e) => e.way) });
  }

  // 3. Croisements géométriques sans nœud commun entre une voie du parcours et une autre voie.
  const ignoredCrossings: IgnoredCrossing[] = [];
  const crossingSuggestions: Suggestion[] = [];
  const seenPairs = new Set<string>();
  for (const re of routeEdges) {
    const p1 = nodes.get(re.a)!;
    const p2 = nodes.get(re.b)!;
    for (const oe of edges) {
      if (oe.onRoute || oe.way.id === re.way.id) continue;
      if (oe.a === re.a || oe.a === re.b || oe.b === re.a || oe.b === re.b) continue;
      const q1 = nodes.get(oe.a)!;
      const q2 = nodes.get(oe.b)!;
      const x = segmentIntersection(p1, p2, q1, q2);
      if (!x) continue;
      const pair = [re.way.id, oe.way.id].sort((m, n) => m - n) as [number, number];
      const pairKey = pair.join('-');
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);
      const pr = route.locate(x);
      const distance = pr ? pr.distance : 0;
      const rt = re.way.tags ?? {};
      const ot = oe.way.tags ?? {};
      if (isElevated(rt) || isElevated(ot) || layer(rt) !== layer(ot)) {
        const what = isElevated(rt) ? 'le parcours passe sur un pont ou dans un tunnel' : 'la voie croisée est un pont, un tunnel ou sur un autre niveau';
        ignoredCrossings.push({ wayIds: pair, position: x, distance, reason: 'Croisement sans connexion : ' + what + '.' });
        continue;
      }
      const unc: string[] = [];
      const branch: Branch = {
        wayId: oe.way.id,
        name: ot.name ?? null,
        highway: ot.highway ?? '?',
        flow: 'variable',
        crossing: true,
        motor: motorAccess(ot, unc),
        tags: usefulTags(ot),
      };
      crossingSuggestions.push({
        stableKey: 'osm:x' + pairKey,
        type: 'verification',
        pertinence: branch.motor === 'non' ? 'faible' : 'moyenne',
        position: x,
        distance,
        passages: route.passages(x, opt.routeTolerance).map((p) => p.distance),
        routeNames: rt.name ? [rt.name] : [],
        branches: [branch],
        restrictions: [],
        nodeIds: [],
        reasons: [
          describeBranch(branch) + ' croise le tracé sans nœud commun avec la voie du parcours (voie OSM ' + re.way.id +
            '), sans pont ni tunnel renseigné.',
        ],
        uncertainties: [...unc, 'Données OSM probablement incomplètes : connexion ou dénivellation à vérifier sur place.'],
      });
    }
  }

  // 4. Regroupement des connexions proches (un carrefour = un point à examiner).
  candidates.sort((a, b) => a.distance - b.distance);
  const clusters: Candidate[][] = [];
  for (const c of candidates) {
    const cluster = clusters.find((cl) =>
      cl.some((o) => Math.abs(o.distance - c.distance) <= opt.clusterRadius && haversine(o.position, c.position) <= opt.clusterRadius),
    );
    if (cluster) cluster.push(c);
    else clusters.push([c]);
  }

  const restrictionsByNode = new Map<number, Restriction[]>();
  for (const rel of relations) {
    if (rel.tags?.type !== 'restriction') continue;
    const via = rel.members.find((m) => m.role === 'via' && m.type === 'node');
    if (!via) continue;
    const r: Restriction = {
      relationId: rel.id,
      restriction: rel.tags.restriction ?? Object.entries(rel.tags).find(([k]) => k.startsWith('restriction:'))?.[1] ?? '?',
      from: rel.members.filter((m) => m.role === 'from').map((m) => m.ref),
      to: rel.members.filter((m) => m.role === 'to').map((m) => m.ref),
    };
    const list = restrictionsByNode.get(via.ref);
    if (list) list.push(r);
    else restrictionsByNode.set(via.ref, [r]);
  }

  const suggestions: Suggestion[] = [];
  for (const cluster of clusters) {
    const s = buildSuggestion(route, cluster, restrictionsByNode, opt);
    if (s) suggestions.push(s);
  }
  // Un croisement sans nœud situé dans un carrefour déjà proposé y est rattaché plutôt que dupliqué.
  for (const cs of crossingSuggestions) {
    const host = suggestions.find((s) => haversine(s.position, cs.position) <= opt.clusterRadius);
    if (host) {
      host.uncertainties.push(...cs.reasons, ...cs.uncertainties);
      continue;
    }
    if (!opt.includeNonMotor && cs.branches.every((b) => b.motor === 'non')) continue;
    suggestions.push(cs);
  }
  suggestions.sort((a, b) => a.distance - b.distance);

  const { unmatched, coverage } = routeCoverage(route, routeEdges, nodes, opt.routeTolerance);

  return {
    suggestions,
    ignoredCrossings,
    unmatched,
    coverage,
    osmTimestamp: data.osm3s?.timestamp_osm_base ?? null,
    stats: { ways: ways.length, nodes: nodes.size, routeEdges: routeEdges.length, candidates: candidates.length },
  };

  function buildSuggestion(
    route: Route,
    cluster: Candidate[],
    restrictionsByNode: Map<number, Restriction[]>,
    o: AnalysisOptions,
  ): Suggestion | null {
    const uncertainties: string[] = [];
    // Une branche par voie (une voie qui traverse le parcours donne deux arêtes au même nœud).
    const branchByWay = new Map<number, { branch: Branch; directions: Set<'in' | 'out'>; node: number }>();
    const clusterNodes = new Set(cluster.map((c) => c.node));
    for (const c of cluster) {
      for (const e of c.branches) {
        const tags = e.way.tags ?? {};
        // Arête interne au regroupement (ex. passage piéton entre trottoir et chaussée) : pas une branche.
        if (clusterNodes.has(e.a) && clusterNodes.has(e.b)) continue;
        const dir: 'in' | 'out' = e.a === c.node ? 'out' : 'in';
        const existing = branchByWay.get(e.way.id);
        if (existing) {
          existing.directions.add(dir);
          continue;
        }
        const unc: string[] = [];
        const motor = motorAccess(tags, unc);
        uncertainties.push(...unc.map((u) => (tags.name ? tags.name + ' : ' : 'Voie ' + e.way.id + ' : ') + u));
        branchByWay.set(e.way.id, {
          branch: { wayId: e.way.id, name: tags.name ?? null, highway: tags.highway ?? '?', flow: 'double_sens', motor, crossing: false, tags: usefulTags(tags) },
          directions: new Set([dir]),
          node: c.node,
        });
      }
    }
    if (!branchByWay.size) return null;

    const branches: Branch[] = [];
    for (const { branch, directions } of branchByWay.values()) {
      const tags = branch.tags;
      branch.crossing = directions.size === 2;
      const ow = onewayDirection(tags);
      if (ow === null) {
        branch.flow = 'variable';
        uncertainties.push(describeBranch(branch) + ' : sens de circulation variable (oneway=' + tags.oneway + ').');
      } else if (ow === 0 || directions.size === 2) {
        // Voie traversante : à sens unique, elle amène quand même des véhicules d'un côté.
        branch.flow = ow === 0 ? 'double_sens' : 'entrant';
      } else {
        // Arête qui part du point de connexion ('out') : un sens unique « dans le sens des nœuds » s'éloigne du parcours.
        const leaves = directions.has('out') ? ow === 1 : ow === -1;
        branch.flow = leaves ? 'sortant' : 'entrant';
      }
      if (tags.highway === 'construction' || tags.construction) uncertainties.push(describeBranch(branch) + ' : voie en travaux dans OSM.');
      if (tags.highway === 'road') uncertainties.push(describeBranch(branch) + ' : type de voie non précisé (highway=road).');
      if (UNCERTAIN_HIGHWAYS.has(tags.highway ?? '') && branch.motor === 'oui' && tags.highway !== 'road') branch.motor = 'incertain';
      if (tags.fixme || tags.FIXME) uncertainties.push(describeBranch(branch) + ' : note de correction OSM (fixme=' + (tags.fixme ?? tags.FIXME) + ').');
      if (MAJOR_HIGHWAYS.has(tags.highway ?? '') && tags.oneway === undefined && tags.junction === undefined)
        uncertainties.push(describeBranch(branch) + ' : sens de circulation non renseigné, double sens supposé.');
      if (tags.barrier) uncertainties.push(describeBranch(branch) + ' : barrière indiquée (barrier=' + tags.barrier + ').');
      branches.push(branch);
    }

    const motorOpen = branches.filter((b) => b.motor === 'oui' || b.motor === 'limite');
    const canEnter = motorOpen.filter((b) => b.flow !== 'sortant');
    const privateOnly = branches.filter((b) => b.motor === 'prive');
    const unsure = branches.filter((b) => b.motor === 'incertain' || b.flow === 'variable');

    let type: SuggestionType;
    // Une voie traversante compte pour deux branches (une de chaque côté du parcours).
    const motorArms = motorOpen.reduce((n, b) => n + (b.crossing ? 2 : 1), 0);
    if (motorArms >= 2) type = 'carrefour';
    else if (canEnter.length === 1) type = 'acces_vehicule_entrant';
    else if (motorOpen.length === 1) type = 'rue_laterale';
    else if (unsure.length) type = 'verification';
    else if (privateOnly.length) type = 'voie_privee';
    else type = 'acces_pieton_cycle';

    if (type === 'acces_pieton_cycle' && !o.includeNonMotor) return null;

    const major = motorOpen.some((b) => MAJOR_HIGHWAYS.has(b.highway));
    const minorService = motorOpen.length > 0 && motorOpen.every((b) => b.highway === 'service' || b.highway === 'track');
    let pertinence: Suggestion['pertinence'];
    if (canEnter.length && (major || motorArms >= 2)) pertinence = 'elevee';
    else if (canEnter.length && !minorService) pertinence = 'moyenne';
    else if (type === 'verification') pertinence = 'moyenne';
    else pertinence = 'faible';

    // Nœud représentatif : de préférence sur la chaussée du parcours, puis celui qui porte le plus de branches
    // motorisées, puis le plus proche du tracé. Ce choix doit être reproductible d'une analyse à l'autre.
    const isMotor = (w: OsmWay) => motorAccess(w.tags ?? {}, []) !== 'non';
    const main = cluster
      .map((c) => ({
        c,
        carriageway: c.onRouteWays.some(isMotor) ? 1 : 0,
        motor: c.branches.filter((e) => isMotor(e.way) && !(clusterNodes.has(e.a) && clusterNodes.has(e.b))).length,
      }))
      .sort((x, y) => y.carriageway - x.carriageway || y.motor - x.motor || x.c.offset - y.c.offset || x.c.node - y.c.node)[0]!.c;

    const passages = route.passages(main.position, o.routeTolerance).map((p) => p.distance);
    if (passages.length > 1) {
      uncertainties.push(
        'Le parcours passe ' + passages.length + ' fois à cet endroit (à ' + passages.map((d) => (d / 1000).toFixed(2) + ' km').join(', ') +
          ') : préciser le passage concerné.',
      );
    }

    const restrictions = cluster.flatMap((c) => restrictionsByNode.get(c.node) ?? []);
    const routeNames = [...new Set(cluster.flatMap((c) => c.onRouteWays.map((w) => w.tags?.name).filter((n): n is string => !!n)))];
    if (!routeNames.length) uncertainties.push('Nom de la voie du parcours absent dans OSM.');

    const reasons: string[] = [];
    const typeText: Record<SuggestionType, string> = {
      carrefour: 'Carrefour : des voies ouvertes aux véhicules rejoignent ou traversent le parcours.',
      acces_vehicule_entrant: 'Accès : une voie ouverte aux véhicules peut amener de la circulation sur le parcours.',
      rue_laterale: 'Rue latérale : voie ouverte aux véhicules, en sens unique depuis le parcours selon OSM.',
      acces_pieton_cycle: 'Accès piéton ou cyclable au parcours.',
      voie_privee: 'Voie privée raccordée au parcours.',
      verification: 'Connexion dont les caractéristiques sont incertaines : vérification manuelle nécessaire.',
    };
    reasons.push(typeText[type]);
    for (const b of branches) reasons.push('Raccordée : ' + describeBranch(b) + '.');
    if (type === 'rue_laterale')
      reasons.push('Le sens unique limite la circulation entrante d\'après OSM ; il ne dispense pas de vérifier ce point.');
    if (cluster.length > 1) reasons.push(cluster.length + ' nœuds OSM regroupés à moins de ' + o.clusterRadius + ' m.');
    for (const r of restrictions) reasons.push('Restriction de tournant ' + r.restriction + ' (relation OSM ' + r.relationId + ').');

    return {
      stableKey: 'osm:n' + main.node,
      type,
      pertinence,
      position: main.position,
      distance: passages[0] ?? main.distance,
      passages: passages.length ? passages : [main.distance],
      routeNames,
      branches,
      restrictions,
      nodeIds: cluster.map((c) => c.node),
      reasons,
      uncertainties: [...new Set(uncertainties)],
    };
  }
}

/** Une arête OSM est portée par le parcours si ses extrémités et son milieu sont proches du tracé et alignés. */
function isOnRoute(route: Route, pa: Position, pb: Position, opt: AnalysisOptions): boolean {
  const mid: Position = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
  const prs = [route.locate(pa), route.locate(mid), route.locate(pb)];
  if (prs.some((p) => !p || p.offset > opt.routeTolerance)) return false;
  if (haversine(pa, pb) < 4) return true;
  const m = prs[1]!;
  return axisDifference(bearing(pa, pb), route.bearingAt(m.segment, m.index)) <= opt.maxAngle;
}

/** Part du parcours longée par des voies OSM reconnues, et portions non reconnues de plus de 50 m. */
function routeCoverage(route: Route, routeEdges: Edge[], nodes: Map<number, Position>, tolerance: number) {
  const step = 10;
  const unmatched: [number, number][] = [];
  if (route.isEmpty || route.length === 0) return { unmatched, coverage: 0 };
  const segs = routeEdges.map((e) => [nodes.get(e.a)!, nodes.get(e.b)!] as const);
  let covered = 0, samples = 0;
  let start: number | null = null;
  for (let d = 0; d <= route.length; d += step) {
    const p = route.pointAt(d)!;
    samples++;
    const ok = segs.some(([a, b]) => projectOnSegment(p, a, b).offset <= tolerance);
    if (ok) {
      covered++;
      if (start !== null && d - start >= 50) unmatched.push([start, d]);
      start = null;
    } else if (start === null) start = d;
  }
  if (start !== null && route.length - start >= 50) unmatched.push([start, route.length]);
  return { unmatched, coverage: covered / samples };
}

/** Requête Overpass : voies du couloir, leurs nœuds, et les restrictions de tournant associées. */
export function overpassQuery(corridor: number, simplified: Position[][]): string {
  const parts = simplified.map(
    (seg) => 'way(around:' + corridor + ',' + seg.map((p) => p[1].toFixed(6) + ',' + p[0].toFixed(6)).join(',') + ')["highway"];',
  );
  return (
    '[out:json][timeout:90];\n(\n  ' + parts.join('\n  ') + '\n)->.w;\n.w out body;\n.w >;\nout skel qt;\n' +
    'rel(bw.w)["type"="restriction"];\nout body;\n'
  );
}
