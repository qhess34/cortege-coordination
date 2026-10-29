import { describe, expect, it } from 'vitest';
import { nearestPicture } from './panoramax';

const pic = (id: string, lon: number, lat: number) => ({ id, collection: 'seq-' + id, geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { datetime: '2025-06-01T10:00:00Z' } });

describe('photo Panoramax la plus proche', () => {
  const at: [number, number] = [2.35, 48.85];

  it('retient la photo la plus proche du clic, avec sa séquence', () => {
    const r = nearestPicture([pic('loin', 2.3504, 48.85), pic('pres', 2.35005, 48.85), pic('moyen', 2.3502, 48.85)], at);
    expect(r).toMatchObject({ id: 'pres', sequence: 'seq-pres' });
    expect(r!.distance).toBeCloseTo(3.7, 0);
  });

  it('ignore les photos hors du rayon et les géométries invalides', () => {
    expect(nearestPicture([pic('loin', 2.352, 48.85), { id: 'x', geometry: { type: 'LineString', coordinates: [] } }], at)).toBeNull();
    expect(nearestPicture([], at)).toBeNull();
  });
});
