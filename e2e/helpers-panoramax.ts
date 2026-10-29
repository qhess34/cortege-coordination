// Faux serveur Panoramax suffisant pour que la visionneuse officielle démarre et affiche une vraie photo.
import type { Page } from '@playwright/test';

export const PIC = '11111111-2222-3333-4444-555555555555';
export const SEQ = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const API = 'https://api.panoramax.xyz/api';

/** Image JPEG produite par le navigateur (dégradé), pour servir de photo. */
async function makeJpeg(page: Page): Promise<Buffer> {
  const url = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 640; c.height = 360;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 640, 0);
    grad.addColorStop(0, '#2a9d8f'); grad.addColorStop(1, '#e9c46a');
    g.fillStyle = grad; g.fillRect(0, 0, 640, 360);
    return c.toDataURL('image/jpeg', 0.8);
  });
  return Buffer.from(url.split(',')[1]!, 'base64');
}

/**
 * Simule l'API. `photoAt(bbox)` donne la position de la photo pour une recherche autour d'un clic
 * (null = aucune photo).
 */
export async function mockPanoramax(page: Page, photoAt: (bbox: number[]) => [number, number] | null) {
  await page.goto('about:blank');
  const jpeg = await makeJpeg(page);
  let position: [number, number] = [2.35, 48.85];
  const feature = () => ({
    type: 'Feature', id: PIC, collection: SEQ,
    geometry: { type: 'Point', coordinates: position },
    properties: { datetime: '2025-06-01T10:00:00Z', 'view:azimuth': 0, 'pers:interior_orientation': { field_of_view: 70 } },
    assets: {
      hd: { href: API + '/pictures/' + PIC + '/hd.jpg', type: 'image/jpeg', roles: ['data'] },
      sd: { href: API + '/pictures/' + PIC + '/sd.jpg', type: 'image/jpeg', roles: ['visual'] },
      thumb: { href: API + '/pictures/' + PIC + '/thumb.jpg', type: 'image/jpeg', roles: ['thumbnail'] },
    },
    links: [],
  });
  await page.route('https://api.panoramax.xyz/**', (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname.replace(/\/$/, '');
    if (p === '/api') {
      return route.fulfill({ json: {
        stac_version: '1.0.0', title: 'Panoramax de test', type: 'Catalog', id: 'test', description: 'test',
        links: [
          { rel: 'search', type: 'application/geo+json', href: API + '/search' },
          { rel: 'data', type: 'application/json', href: API + '/collections' },
        ],
      } });
    }
    if (p === '/api/search' && url.searchParams.has('bbox')) {
      const at = photoAt(url.searchParams.get('bbox')!.split(',').map(Number));
      if (at) position = at;
      return route.fulfill({ json: { type: 'FeatureCollection', features: at ? [feature()] : [] } });
    }
    if (p === '/api/search' || p === '/api/collections/' + SEQ + '/items/' + PIC) {
      return route.fulfill({ json: p.endsWith(PIC) ? feature() : { type: 'FeatureCollection', features: [feature()] } });
    }
    if (p === '/api/collections/' + SEQ) return route.fulfill({ json: { type: 'Collection', id: SEQ, links: [], extent: {} } });
    if (p.endsWith('.jpg')) return route.fulfill({ body: jpeg, contentType: 'image/jpeg' });
    return route.fulfill({ status: 404, body: '' });
  });
}
