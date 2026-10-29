// Production d'images de carte pour l'impression : une seule carte cachée, déplacée d'une vue à l'autre,
// dont on capture le rendu. Fond raster (les images restent lisibles à l'impression), tracé et points dessinés.
import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap } from 'maplibre-gl';
import { BASEMAPS } from '../basemaps';
import type { Position } from '../types';

export interface SnapshotPoint { id: string; position: Position; color: string; label: string }
export interface SnapshotView {
  key: string; center?: Position; zoom?: number; bounds?: [Position, Position]; maxZoom?: number;
  /** Points mis en évidence (cercle rouge). */
  highlight?: string[];
  /** Numéros dessinés sur l'image (ordre des missions). */
  labels?: { position: Position; text: string }[];
}

const empty = { type: 'FeatureCollection' as const, features: [] };

function waitIdle(m: MlMap, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, timeoutMs);
    m.once('idle', () => { clearTimeout(t); resolve(); });
    m.triggerRepaint();
  });
}

/**
 * Rend chaque vue et renvoie les images (data URL PNG) au fur et à mesure via `onImage`.
 * `basemapId` : fond raster à utiliser ; à défaut, le plan OSM en images.
 */
export async function renderSnapshots(opts: {
  width: number; height: number; basemapId: string;
  track: Position[][] | null; points: SnapshotPoint[]; views: SnapshotView[];
  onImage: (key: string, dataUrl: string) => void; signal: AbortSignal; timeoutMs?: number;
}): Promise<void> {
  const base = BASEMAPS.find((b) => b.id === opts.basemapId && b.tiles) ?? BASEMAPS.find((b) => b.id === 'osm')!;
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:' + opts.width + 'px;height:' + opts.height + 'px;';
  document.body.appendChild(host);
  const m = new maplibregl.Map({
    container: host,
    style: {
      version: 8,
      sources: { fond: { type: 'raster', tiles: [base.tiles!], tileSize: 256, maxzoom: base.maxzoom } },
      layers: [{ id: 'fond', type: 'raster', source: 'fond' }],
    },
    interactive: false,
    attributionControl: false,
    fadeDuration: 0,
    pixelRatio: 2,
    canvasContextAttributes: { preserveDrawingBuffer: true },
    center: [2.35, 48.85],
    zoom: 12,
  });
  try {
    await new Promise<void>((resolve) => m.once('load', () => resolve()));
    m.addSource('track', { type: 'geojson', data: opts.track ? { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: opts.track }, properties: {} } : empty });
    m.addSource('points', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: opts.points.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p.position }, properties: { id: p.id, color: p.color } })) },
    });
    m.addLayer({ id: 'track-casing', type: 'line', source: 'track', paint: { 'line-color': '#ffffff', 'line-width': 8 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
    m.addLayer({ id: 'track', type: 'line', source: 'track', paint: { 'line-color': '#1d3557', 'line-width': 4 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
    m.addLayer({ id: 'points', type: 'circle', source: 'points', paint: { 'circle-radius': 6, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } });
    m.addLayer({
      id: 'highlight', type: 'circle', source: 'points', filter: ['==', ['get', 'id'], ''],
      paint: { 'circle-radius': 11, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#d62828', 'circle-stroke-width': 4 },
    });
    for (const v of opts.views) {
      if (opts.signal.aborted) return;
      m.setFilter('highlight', ['in', ['get', 'id'], ['literal', v.highlight ?? []]]);
      if (v.bounds) m.fitBounds(v.bounds, { padding: 60, duration: 0, maxZoom: v.maxZoom ?? 17 });
      else m.jumpTo({ center: v.center, zoom: v.zoom ?? 17 });
      await waitIdle(m, opts.timeoutMs ?? 10_000);
      if (opts.signal.aborted) return;
      opts.onImage(v.key, compose(m, v.labels ?? []));
    }
  } finally {
    m.remove();
    host.remove();
  }
}

/** Image finale : rendu de la carte, plus les numéros des points (dessinés en 2D, sans police de carte). */
function compose(m: MlMap, labels: { position: Position; text: string }[]): string {
  const src = m.getCanvas();
  if (!labels.length) return src.toDataURL('image/png');
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext('2d')!;
  g.drawImage(src, 0, 0);
  const ratio = src.width / src.clientWidth;
  const r = 10 * ratio;
  g.font = 'bold ' + Math.round(11 * ratio) + 'px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const l of labels) {
    const p = m.project(l.position);
    // Étiquette décalée en haut à droite du point, pour ne pas le masquer.
    const x = (p.x + 14) * ratio;
    const y = (p.y - 14) * ratio;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fillStyle = '#ffffff';
    g.fill();
    g.lineWidth = 2 * ratio;
    g.strokeStyle = '#1d3557';
    g.stroke();
    g.fillStyle = '#1d3557';
    g.fillText(l.text, x, y + ratio);
  }
  return c.toDataURL('image/png');
}
