// Regroupement des points proches du roadbook (ex. les accès d'un même carrefour).
import { haversine } from '../../../server/src/geo/route';
import type { Position } from '../types';

export interface RbPoint {
  id: number; name: string; type: string; description: string; origin: string; position: Position; distance: number | null;
  osm: { routeNames: string[]; branches: { name: string | null; highway: string; flow: string; motor: string }[]; uncertainties: string[] } | null;
}

/** Élément d'une section du roadbook : un point, avec son numéro de mission s'il en a un. */
export interface Item { point: RbPoint; order?: number; instructions?: string }
/** Lieu : points proches les uns des autres (ex. les accès d'un même carrefour), présentés ensemble. */
export interface Group { key: string; title: string; items: Item[] }

/** Distance (m) en deçà de laquelle deux points sont présentés comme un même lieu. */
const GROUP_RADIUS = 50;

/** Regroupe les points proches (de proche en proche), dans l'ordre de leur première apparition. */
export function groupItems(items: Item[], section: string, radius = GROUP_RADIUS): Group[] {
  const groups: Item[][] = [];
  for (const it of items) {
    const near = groups.filter((g) => g.some((o) => haversine(o.point.position, it.point.position) <= radius));
    if (!near.length) groups.push([it]);
    else {
      // Le point relie éventuellement plusieurs lieux : on les fusionne dans le premier.
      const [first, ...others] = near;
      first!.push(it, ...others.flat());
      for (const o of others) groups.splice(groups.indexOf(o), 1);
    }
  }
  return groups.map((g) => {
    g.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const names = [...new Set(g.flatMap((i) => [...(i.point.osm?.routeNames ?? []), ...(i.point.osm?.branches.map((b) => b.name) ?? [])]).filter((n): n is string => !!n))];
    const title = g.length === 1 ? g[0]!.point.name : names.length ? names.join(' / ') : 'Points proches';
    return { key: 'g' + section + '-' + g.map((i) => i.point.id).join('-'), title, items: g };
  });
}

