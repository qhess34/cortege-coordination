// Calculs géographiques sur un parcours : distances, projection d'un point, passages multiples.
// Coordonnées en [longitude, latitude] (ordre GeoJSON), distances en mètres.

export type Position = [number, number];

const R = 6371008.8; // rayon moyen de la Terre (m)
const rad = (d: number) => (d * Math.PI) / 180;

export function haversine(a: Position, b: Position): number {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Projection locale équirectangulaire (précise à quelques mm sur quelques km). */
function toLocal(p: Position, origin: Position): [number, number] {
  const k = Math.cos(rad(origin[1]));
  return [rad(p[0] - origin[0]) * R * k, rad(p[1] - origin[1]) * R];
}

/** Projection d'un point sur un segment : fraction t ∈ [0,1] et distance au segment. */
export function projectOnSegment(p: Position, a: Position, b: Position): { t: number; offset: number } {
  const [px, py] = toLocal(p, a);
  const [bx, by] = toLocal(b, a);
  const len2 = bx * bx + by * by;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len2));
  return { t, offset: Math.hypot(px - t * bx, py - t * by) };
}

/** Cap (degrés, 0 = nord, sens horaire) de a vers b. */
export function bearing(a: Position, b: Position): number {
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
  const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Écart angulaire entre deux directions, sans tenir compte du sens (0 à 90°). */
export function axisDifference(b1: number, b2: number): number {
  const d = Math.abs(b1 - b2) % 180;
  return d > 90 ? 180 - d : d;
}

export interface Projection {
  /** Distance cumulée le long du parcours (m). */
  distance: number;
  /** Distance du point au parcours (m). */
  offset: number;
  segment: number;
  index: number;
  /** Position projetée sur le parcours. */
  point: Position;
}

/**
 * Parcours composé d'un ou plusieurs segments (traces GPX). La distance cumulée s'enchaîne d'un segment
 * au suivant sans compter l'éventuel saut entre eux (signalé à l'import).
 */
export class Route {
  readonly segments: Position[][];
  /** cumul[s][i] = distance cumulée au sommet i du segment s. */
  readonly cumul: number[][];
  readonly length: number;

  constructor(segments: Position[][]) {
    this.segments = segments.filter((s) => s.length >= 2);
    this.cumul = [];
    let total = 0;
    for (const seg of this.segments) {
      const c = [total];
      for (let i = 1; i < seg.length; i++) {
        total += haversine(seg[i - 1]!, seg[i]!);
        c.push(total);
      }
      this.cumul.push(c);
    }
    this.length = total;
  }

  get isEmpty(): boolean {
    return this.segments.length === 0;
  }

  /** Toutes les projections par sous-segment (utile pour trouver plusieurs passages). */
  private *projections(p: Position): Generator<Projection> {
    for (let s = 0; s < this.segments.length; s++) {
      const seg = this.segments[s]!;
      const cum = this.cumul[s]!;
      for (let i = 0; i < seg.length - 1; i++) {
        const a = seg[i]!;
        const b = seg[i + 1]!;
        const { t, offset } = projectOnSegment(p, a, b);
        yield {
          distance: cum[i]! + t * (cum[i + 1]! - cum[i]!),
          offset,
          segment: s,
          index: i,
          point: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])],
        };
      }
    }
  }

  /** Projection la plus proche. */
  locate(p: Position): Projection | null {
    let best: Projection | null = null;
    for (const pr of this.projections(p)) if (!best || pr.offset < best.offset) best = pr;
    return best;
  }

  /**
   * Passages du parcours à moins de `tolerance` m du point. Un parcours en boucle ou en aller-retour peut passer
   * plusieurs fois au même endroit : on garde le meilleur point de chaque passage, deux passages étant séparés
   * d'au moins `minGap` m le long du parcours.
   */
  passages(p: Position, tolerance: number, minGap = 2 * tolerance + 20): Projection[] {
    const near = [...this.projections(p)].filter((pr) => pr.offset <= tolerance).sort((a, b) => a.distance - b.distance);
    const groups: Projection[][] = [];
    for (const pr of near) {
      const last = groups[groups.length - 1];
      const prev = last?.[last.length - 1];
      if (last && prev && pr.distance - prev.distance < minGap) last.push(pr);
      else groups.push([pr]);
    }
    return groups.map((g) => g.reduce((a, b) => (b.offset < a.offset ? b : a)));
  }

  /** Point situé à une distance cumulée donnée. */
  pointAt(distance: number): Position | null {
    if (this.isEmpty) return null;
    const d = Math.max(0, Math.min(this.length, distance));
    for (let s = 0; s < this.segments.length; s++) {
      const seg = this.segments[s]!;
      const cum = this.cumul[s]!;
      if (d > cum[cum.length - 1]! && s < this.segments.length - 1) continue;
      for (let i = 0; i < seg.length - 1; i++) {
        if (d <= cum[i + 1]! || i === seg.length - 2) {
          const span = cum[i + 1]! - cum[i]!;
          const t = span === 0 ? 0 : Math.max(0, Math.min(1, (d - cum[i]!) / span));
          const a = seg[i]!;
          const b = seg[i + 1]!;
          return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
        }
      }
    }
    return null;
  }

  /** Direction locale du parcours au sous-segment donné. */
  bearingAt(segment: number, index: number): number {
    const seg = this.segments[segment]!;
    return bearing(seg[index]!, seg[index + 1]!);
  }

  /** Emprise [ouest, sud, est, nord]. */
  bbox(): [number, number, number, number] {
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const seg of this.segments)
      for (const [x, y] of seg) {
        w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y);
      }
    return [w, s, e, n];
  }
}

/** Simplification Douglas-Peucker (tolérance en mètres), pour alléger les requêtes Overpass. */
export function simplify(line: Position[], tolerance: number): Position[] {
  if (line.length <= 2) return line.slice();
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    let max = 0, idx = -1;
    for (let k = i + 1; k < j; k++) {
      const { offset } = projectOnSegment(line[k]!, line[i]!, line[j]!);
      if (offset > max) { max = offset; idx = k; }
    }
    if (idx >= 0 && max > tolerance) {
      keep[idx] = 1;
      stack.push([i, idx], [idx, j]);
    }
  }
  return line.filter((_, k) => keep[k]);
}
