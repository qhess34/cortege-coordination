// Carte de la coordination en direct (téléphone) : parcours, points colorés par statut, incidents, membres suivis.
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { useEffect, useRef, useState } from 'react';
import { BASEMAPS } from '../basemaps';
import { MISSION_STATUS } from '../labels';
import type { Position } from '../types';
import type { MemberPosition } from './MapView';
import { loadVectorBasemap } from './vectorBasemap';

maplibregl.setWorkerUrl(workerUrl);

/** Couleur d'un point selon le statut de sa mission (légende affichée sous la carte). */
export const STATUS_COLOR: Record<string, string> = {
  a_preparer: '#adb5bd', affectee: '#8d99ae', en_deplacement: '#3a86ff', en_position: '#2a9d8f', terminee: '#ced4da',
  releve_necessaire: '#f4a261', incident: '#d62828',
};

export interface LivePoint { position: Position; label: string; status: string; passedByTail: boolean }
export interface LiveIncident { position: Position; label: string; priority: string }

type Feature = { type: 'Feature'; properties: Record<string, unknown>; geometry: { type: 'Point' | 'LineString'; coordinates: unknown } };
const fc = (features: Feature[]) => ({ type: 'FeatureCollection' as const, features }) as never;

export function LiveMap({ track, points, incidents, members }: { track: Position[][]; points: LivePoint[]; incidents: LiveIncident[]; members: MemberPosition[] }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const ready = useRef(false);
  const markers = useRef(new Map<number, maplibregl.Marker>());
  const latest = useRef({ track, points, incidents, members });
  latest.current = { track, points, incidents, members };
  const fitted = useRef(false);
  const [basemapError, setBasemapError] = useState(false);

  const sync = () => {
    const m = map.current;
    if (!m || !ready.current) return;
    const d = latest.current;
    (m.getSource('parcours') as GeoJSONSource).setData(fc(d.track.map((s) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: s } }))));
    (m.getSource('points') as GeoJSONSource).setData(fc(d.points.map((p) => ({
      type: 'Feature', properties: { color: STATUS_COLOR[p.status] ?? '#8d99ae', lever: p.passedByTail && p.status !== 'terminee' }, geometry: { type: 'Point', coordinates: p.position },
    }))));
    (m.getSource('incidents') as GeoJSONSource).setData(fc(d.incidents.map((i) => ({
      type: 'Feature', properties: { haute: i.priority === 'haute' }, geometry: { type: 'Point', coordinates: i.position },
    }))));
    const seen = new Set<number>();
    for (const p of d.members) {
      seen.add(p.userId);
      let mk = markers.current.get(p.userId);
      if (!mk) {
        const e = document.createElement('div');
        e.className = 'member-marker';
        e.innerHTML = '<span class="member-dot"></span><span class="member-name"></span>';
        mk = new maplibregl.Marker({ element: e }).setLngLat(p.position).addTo(m);
        markers.current.set(p.userId, mk);
      }
      const e = mk.getElement();
      (e.querySelector('.member-dot') as HTMLElement).style.background = p.color;
      e.querySelector('.member-name')!.textContent = p.displayName;
      mk.setLngLat(p.position);
    }
    for (const [id, mk] of markers.current) if (!seen.has(id)) { mk.remove(); markers.current.delete(id); }
    // Cadrage initial sur le parcours, ou à défaut sur les points.
    const extent = d.track.length ? d.track.flat() : d.points.map((p) => p.position);
    if (!fitted.current && extent.length) {
      const b = new maplibregl.LngLatBounds();
      for (const p of extent) b.extend(p);
      m.fitBounds(b, { padding: 30, duration: 0, maxZoom: 17 });
      fitted.current = true;
    }
  };

  useEffect(() => {
    if (!el.current) return;
    const osm = BASEMAPS.find((b) => b.id === 'osm')!;
    const m = new maplibregl.Map({
      container: el.current,
      style: {
        version: 8,
        sources: { fond: { type: 'raster', tiles: [osm.tiles!], tileSize: 256, maxzoom: osm.maxzoom, attribution: osm.attribution } },
        layers: [{ id: 'fond', type: 'raster', source: 'fond', layout: { visibility: 'none' } }],
      },
      center: [2.35, 48.85], zoom: 13, attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false,
    });
    map.current = m;
    m.touchZoomRotate.disableRotation();
    // Le conteneur peut changer de taille (rotation, barre d'adresse, onglet affiché) : la carte suit.
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(el.current);
    // Tuiles de fond qui ne se chargent pas (réseau, fournisseur) : signalé sous la carte.
    m.on('error', (e) => { if ((e as { sourceId?: string }).sourceId || /tile|Failed to fetch/i.test(String(e.error?.message))) setBasemapError(true); });
    m.on('data', (e) => { if ((e as { dataType?: string; tile?: unknown }).dataType === 'source' && (e as { tile?: unknown }).tile) setBasemapError(false); });
    m.on('load', () => {
      for (const id of ['parcours', 'points', 'incidents']) m.addSource(id, { type: 'geojson', data: fc([]) });
      m.addLayer({ id: 'parcours', type: 'line', source: 'parcours', paint: { 'line-color': '#1d3557', 'line-width': 5, 'line-opacity': 0.55 } });
      m.addLayer({
        id: 'points', type: 'circle', source: 'points',
        paint: { 'circle-radius': 8, 'circle-color': ['get', 'color'], 'circle-stroke-color': ['case', ['get', 'lever'], '#f4a261', '#fff'], 'circle-stroke-width': ['case', ['get', 'lever'], 4, 2] },
      });
      m.addLayer({
        id: 'incidents', type: 'circle', source: 'incidents',
        paint: { 'circle-radius': ['case', ['get', 'haute'], 12, 9], 'circle-color': 'rgba(214,40,40,.25)', 'circle-stroke-color': '#d62828', 'circle-stroke-width': 3 },
      });
      ready.current = true;
      sync();
      const vector = BASEMAPS.find((b) => b.style);
      const fallback = () => { if (m.getLayer('fond')) m.setLayoutProperty('fond', 'visibility', 'visible'); };
      if (vector?.style) loadVectorBasemap(m, vector.style, 'parcours').catch(fallback);
      else fallback();
    });
    return () => { ro.disconnect(); ready.current = false; for (const mk of markers.current.values()) mk.remove(); markers.current.clear(); m.remove(); map.current = null; };
    // La carte est créée une fois ; les données suivent par sync().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(sync, [track, points, incidents, members]);

  return (
    <div className="stack">
      <div ref={el} className="live-map" data-testid="carte-direct" />
      {basemapError && <p className="warning small" role="status">Le fond de carte ne se charge pas (connexion ou fournisseur de tuiles) : le parcours et les points restent affichés.</p>}
      <p className="legend small">
        {['en_deplacement', 'en_position', 'releve_necessaire', 'incident', 'affectee'].map((s) => (
          <span key={s}><span className="dot" style={{ background: STATUS_COLOR[s] }} /> {MISSION_STATUS[s]}</span>
        ))}
        <span><span className="dot ring" /> à lever</span>
        <span><span className="dot inc" /> lieu d’un incident</span>
      </p>
    </div>
  );
}
