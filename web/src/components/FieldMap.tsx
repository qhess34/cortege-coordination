// Carte légère de la vue terrain : parcours, points de l'équipe, position de l'appareil (locale) et itinéraire.
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { useEffect, useRef } from 'react';
import { BASEMAPS } from '../basemaps';
import { loadVectorBasemap } from './vectorBasemap';
import type { Position } from '../types';

maplibregl.setWorkerUrl(workerUrl);

export interface FieldPoint { position: Position; label: string; current: boolean; done: boolean }

interface Props {
  track: Position[][];
  points: FieldPoint[];
  me: Position | null;
  route: Position[] | null;
  color: string;
}

type Feature = { type: 'Feature'; properties: Record<string, unknown>; geometry: { type: 'Point' | 'LineString'; coordinates: unknown } };
const fc = (features: Feature[]) => ({ type: 'FeatureCollection' as const, features }) as never;

export function FieldMap({ track, points, me, route, color }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const ready = useRef(false);
  const latest = useRef({ track, points, me, route });
  latest.current = { track, points, me, route };

  const sync = () => {
    const m = map.current;
    if (!m || !ready.current) return;
    const { track: t, points: p, me: pos, route: r } = latest.current;
    (m.getSource('parcours') as GeoJSONSource).setData(fc(t.map((s) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: s } }))));
    (m.getSource('points') as GeoJSONSource).setData(fc(p.map((x) => ({
      type: 'Feature', properties: { label: x.label, current: x.current, done: x.done }, geometry: { type: 'Point', coordinates: x.position },
    }))));
    (m.getSource('moi') as GeoJSONSource).setData(fc(pos ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: pos } }] : []));
    (m.getSource('itineraire') as GeoJSONSource).setData(fc(r ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: r } }] : []));
  };

  useEffect(() => {
    if (!el.current) return;
    const osm = BASEMAPS.find((b) => b.id === 'osm')!;
    const current = latest.current.points.find((p) => p.current) ?? latest.current.points[0];
    const m = new maplibregl.Map({
      container: el.current,
      style: {
        version: 8,
        sources: { fond: { type: 'raster', tiles: [osm.tiles!], tileSize: 256, maxzoom: osm.maxzoom, attribution: osm.attribution } },
        // Tuiles OSM en images : seulement en secours si le plan vectoriel échoue.
        layers: [{ id: 'fond', type: 'raster', source: 'fond', layout: { visibility: 'none' } }],
      },
      center: current?.position ?? latest.current.track[0]?.[0] ?? [2.35, 48.85],
      zoom: current ? 17 : 14,
      attributionControl: { compact: true },
      dragRotate: false,
      // Sur téléphone : un doigt fait défiler la page, deux doigts déplacent la carte.
      cooperativeGestures: true,
      pitchWithRotate: false,
    });
    map.current = m;
    m.touchZoomRotate.disableRotation();
    m.on('load', () => {
      const empty = fc([]);
      for (const id of ['parcours', 'points', 'moi', 'itineraire']) m.addSource(id, { type: 'geojson', data: empty });
      m.addLayer({ id: 'parcours', type: 'line', source: 'parcours', paint: { 'line-color': '#1d3557', 'line-width': 5, 'line-opacity': 0.55 } });
      m.addLayer({ id: 'itineraire', type: 'line', source: 'itineraire', paint: { 'line-color': '#2a9d8f', 'line-width': 4, 'line-dasharray': [2, 1.5] } });
      m.addLayer({
        id: 'points', type: 'circle', source: 'points',
        paint: {
          'circle-radius': ['case', ['get', 'current'], 11, 7],
          'circle-color': ['case', ['get', 'done'], '#8d99ae', color],
          'circle-stroke-color': '#fff', 'circle-stroke-width': ['case', ['get', 'current'], 3, 2],
        },
      });
      m.addLayer({
        id: 'moi', type: 'circle', source: 'moi',
        paint: { 'circle-radius': 8, 'circle-color': '#3a86ff', 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 },
      });
      ready.current = true;
      sync();
      const vector = BASEMAPS.find((b) => b.style);
      const fallback = () => { if (m.getLayer('fond')) m.setLayoutProperty('fond', 'visibility', 'visible'); };
      if (vector?.style) loadVectorBasemap(m, vector.style, 'parcours').catch(fallback);
      else fallback();
    });
    return () => { ready.current = false; m.remove(); map.current = null; };
    // La carte est créée une fois ; les données suivent par sync().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(sync, [track, points, me, route]);

  // Recentre sur le point courant, ou englobe la position et l'itinéraire.
  const currentKey = points.find((p) => p.current)?.position.join() ?? '';
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const cur = points.find((p) => p.current);
    if (route?.length) {
      const b = new maplibregl.LngLatBounds();
      for (const p of route) b.extend(p);
      m.fitBounds(b, { padding: 40, maxZoom: 18, duration: 500 });
    } else if (cur) m.easeTo({ center: cur.position, zoom: Math.max(m.getZoom(), 16), duration: 500 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey, route]);

  return <div ref={el} className="field-map" data-testid="carte-terrain" />;
}
