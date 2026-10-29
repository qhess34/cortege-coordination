import { describe, expect, it } from 'vitest';
import { groupItems, type Item } from './roadbookGroups';

// Position à x mètres à l'est et y mètres au nord de 2.35, 48.85.
const at = (x: number, y: number): [number, number] => [2.35 + x / (111195 * Math.cos((48.85 * Math.PI) / 180)), 48.85 + y / 111195];
const item = (id: number, x: number, y: number, order?: number, names: string[] = []): Item => ({
  order,
  point: {
    id, name: 'P' + id, type: 'autre', description: '', origin: 'manuel', position: at(x, y), distance: null,
    osm: names.length ? { routeNames: [names[0]!], branches: names.slice(1).map((n) => ({ name: n, highway: 'residential', flow: 'double_sens', motor: 'oui' })), uncertainties: [] } : null,
  },
});

describe('regroupement des points proches du roadbook', () => {
  it('réunit les accès d’un même carrefour, garde les autres points à part, dans l’ordre des missions', () => {
    const groups = groupItems([
      item(1, 0, 20, 1, ['Rue A', 'Rue B']),
      item(2, 300, 0, 2),
      item(3, 0, -20, 3, ['Rue A', 'Rue B']),
      item(4, 25, 0, 4, ['Rue A', 'Rue C']),
    ], 'x');
    expect(groups.map((g) => g.items.map((i) => i.order))).toEqual([[1, 3, 4], [2]]);
    expect(groups[0]!.title).toBe('Rue A / Rue B / Rue C');
    expect(groups[1]!.title).toBe('P2');
  });

  it('enchaîne les points proches de proche en proche, et fusionne deux lieux reliés', () => {
    const groups = groupItems([item(1, 0, 0, 1), item(2, 90, 0, 2), item(3, 45, 0, 3)], 'x');
    expect(groups.map((g) => g.items.map((i) => i.order))).toEqual([[1, 2, 3]]);
    expect(groups[0]!.title).toBe('Points proches');
  });
});
