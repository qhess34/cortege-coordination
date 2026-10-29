import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MlMap, MapMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 charge son worker depuis un fichier séparé : on le fait empaqueter par Vite.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Route } from '../../../server/src/geo/route';
import { BASEMAPS, DEFAULT_BASEMAP } from '../basemaps';
import type { MissionPoint, Position, Suggestion, Track } from '../types';

maplibregl.setWorkerUrl(workerUrl);

export type Selection = { kind: 'suggestion' | 'point'; id: number } | null;

interface Props {
  track: Track | null;
  suggestions: Suggestion[];
  points: MissionPoint[];
  selection: Selection;
  addMode: boolean;
  onSelect: (s: Selection) => void;
  onMapClick: (p: Position) => void;
  onPointMove: (id: number, p: Position) => void;
  /** Clic hors mode ajout : position à inspecter (vue Panoramax). */
  onInspect?: (p: Position) => void;
  /** Identifiant du fond de carte (voir basemaps.ts). */
  basemap?: string;
  /** Affiche la couverture Panoramax et les repères d'inspection. */
  panoramax?: { enabled: boolean; tilesUrl: string; clicked: Position | null; photo: Position | null };
}


export const TYPE_COLORS: Record<string, string> = {
  carrefour: '#d62828',
  acces_vehicule_entrant: '#f77f00',
  rue_laterale: '#fcbf49',
  verification: '#9b5de5',
  voie_privee: '#6c757d',
  acces_pieton_cycle: '#2a9d8f',
};

const empty = { type: 'FeatureCollection' as const, features: [] };

function arrowImage(): ImageData {
  const c = document.createElement('canvas');
  c.width = c.height = 24;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#1d3557';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(6, 5);
  g.lineTo(19, 12);
  g.lineTo(6, 19);
  g.closePath();
  g.fill();
  g.stroke();
  return g.getImageData(0, 0, 24, 24);
}

export function MapView(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const kmMarkers = useRef<maplibregl.Marker[]>([]);
  const dragMarker = useRef<maplibregl.Marker | null>(null);
  // Les gestionnaires d'événements MapLibre lisent toujours les dernières props.
  const latest = useRef(props);
  latest.current = props;
  const fitted = useRef<number | null>(null);

  useEffect(() => {
    if (!container.current) return;
    const m = new maplibregl.Map({
      container: container.current,
      style: {
        version: 8,
        // Un seul fond visible à la fois ; les tuiles des fonds masqués ne sont pas téléchargées.
        sources: Object.fromEntries(BASEMAPS.map((b) => [
          'fond-' + b.id,
          { type: 'raster' as const, tiles: [b.tiles], tileSize: 256, maxzoom: b.maxzoom, attribution: b.attribution },
        ])),
        layers: BASEMAPS.map((b) => ({
          id: 'fond-' + b.id, type: 'raster' as const, source: 'fond-' + b.id,
          layout: { visibility: b.id === (props.basemap ?? DEFAULT_BASEMAP) ? 'visible' as const : 'none' as const },
        })),
      },
      center: [2.35, 48.85],
      zoom: 12,
      maxZoom: 20,
      attributionControl: { compact: false },
    });
    m.addControl(new maplibregl.NavigationControl(), 'top-left');
    m.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    m.on('load', () => {
      m.addImage('arrow', arrowImage());
      m.addSource('track', { type: 'geojson', data: empty });
      m.addSource('suggestions', { type: 'geojson', data: empty });
      m.addSource('points', { type: 'geojson', data: empty });
      m.addLayer({ id: 'track-casing', type: 'line', source: 'track', paint: { 'line-color': '#ffffff', 'line-width': 9 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
      m.addLayer({ id: 'track', type: 'line', source: 'track', paint: { 'line-color': '#1d3557', 'line-width': 5 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
      m.addLayer({ id: 'track-arrows', type: 'symbol', source: 'track', layout: { 'symbol-placement': 'line', 'symbol-spacing': 90, 'icon-image': 'arrow', 'icon-size': 0.8, 'icon-allow-overlap': true } });
      m.addLayer({
        id: 'suggestions', type: 'circle', source: 'suggestions',
        paint: {
          'circle-radius': ['match', ['get', 'pertinence'], 'elevee', 8, 'moyenne', 7, 6],
          'circle-color': ['match', ['get', 'type'], ...Object.entries(TYPE_COLORS).flat(), '#999999'] as unknown as string,
          'circle-opacity': ['match', ['get', 'status'], 'ecartee', 0.35, 'validee', 0.5, 0.95],
          'circle-stroke-color': ['case', ['get', 'selected'], '#000000', '#ffffff'],
          'circle-stroke-width': ['case', ['get', 'selected'], 3, 1.5],
        },
      });
      m.addLayer({
        id: 'points', type: 'circle', source: 'points',
        paint: {
          'circle-radius': 9,
          'circle-color': ['get', 'color'],
          'circle-stroke-color': ['case', ['get', 'selected'], '#000000', '#ffffff'],
          'circle-stroke-width': ['case', ['get', 'selected'], 4, 2.5],
        },
      });
      // Couverture Panoramax (séquences de photos), sous le tracé.
      const pnx = latest.current.panoramax;
      if (pnx) {
        m.addSource('panoramax', { type: 'vector', tiles: [pnx.tilesUrl], minzoom: 0, maxzoom: 15, attribution: 'Photos © contributeurs <a href="https://panoramax.fr" target="_blank" rel="noreferrer">Panoramax</a>' });
        m.addLayer({
          id: 'panoramax-sequences', type: 'line', source: 'panoramax', 'source-layer': 'sequences', minzoom: 13,
          layout: { visibility: pnx.enabled ? 'visible' : 'none', 'line-cap': 'round' },
          paint: { 'line-color': '#ff6f00', 'line-width': 2.5, 'line-opacity': 0.55 },
        }, 'track-casing');
      }
      m.addSource('inspect', { type: 'geojson', data: empty });
      m.addLayer({
        id: 'inspect', type: 'circle', source: 'inspect',
        paint: {
          'circle-radius': ['match', ['get', 'kind'], 'photo', 6, 7],
          'circle-color': ['match', ['get', 'kind'], 'photo', '#ff6f00', 'rgba(0,0,0,0)'],
          'circle-stroke-color': ['match', ['get', 'kind'], 'photo', '#ffffff', '#ff6f00'],
          'circle-stroke-width': 3,
        },
      });
      setReady(true);
    });
    m.on('click', (e: MapMouseEvent) => {
      const hits = m.queryRenderedFeatures(e.point, { layers: ['points', 'suggestions'] });
      const f = hits[0];
      const clicked: Position = [e.lngLat.lng, e.lngLat.lat];
      if (latest.current.addMode) {
        latest.current.onMapClick(clicked);
        return;
      }
      if (f) {
        latest.current.onSelect({ kind: f.layer.id === 'points' ? 'point' : 'suggestion', id: Number(f.properties.id) });
        // Pour un point ou une suggestion, on inspecte l'élément lui-même plutôt que l'endroit exact du clic.
        const g = f.geometry;
        latest.current.onInspect?.(g.type === 'Point' ? [g.coordinates[0]!, g.coordinates[1]!] : clicked);
      } else {
        latest.current.onSelect(null);
        latest.current.onInspect?.(clicked);
      }
    });
    for (const layer of ['points', 'suggestions']) {
      m.on('mouseenter', layer, () => { m.getCanvas().style.cursor = 'pointer'; });
      m.on('mouseleave', layer, () => { m.getCanvas().style.cursor = ''; });
    }
    map.current = m;
    return () => { m.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    if (map.current) map.current.getCanvas().style.cursor = props.addMode ? 'crosshair' : '';
  }, [props.addMode]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const wanted = BASEMAPS.some((b) => b.id === props.basemap) ? props.basemap : DEFAULT_BASEMAP;
    for (const b of BASEMAPS) m.setLayoutProperty('fond-' + b.id, 'visibility', b.id === wanted ? 'visible' : 'none');
  }, [props.basemap, ready]);

  const pnx = props.panoramax;
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !pnx) return;
    if (m.getLayer('panoramax-sequences')) m.setLayoutProperty('panoramax-sequences', 'visibility', pnx.enabled ? 'visible' : 'none');
    const features = [];
    if (pnx.enabled && pnx.clicked) features.push({ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: pnx.clicked }, properties: { kind: 'clic' } });
    if (pnx.enabled && pnx.photo) features.push({ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: pnx.photo }, properties: { kind: 'photo' } });
    (m.getSource('inspect') as GeoJSONSource).setData({ type: 'FeatureCollection', features });
  }, [pnx?.enabled, pnx?.clicked, pnx?.photo, ready]);

  const route = useMemo(() => (props.track ? new Route(props.track.geometry.coordinates) : null), [props.track]);

  // Tracé et repères kilométriques.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    (m.getSource('track') as GeoJSONSource).setData(
      props.track ? { type: 'Feature', geometry: props.track.geometry, properties: {} } : empty,
    );
    kmMarkers.current.forEach((k) => k.remove());
    kmMarkers.current = [];
    if (!route || !props.track) return;
    const step = route.length > 15000 ? 2000 : route.length > 4000 ? 1000 : 500;
    const marks: [number, string][] = [[0, 'Départ']];
    for (let d = step; d < route.length - step / 3; d += step) marks.push([d, (d / 1000).toLocaleString('fr-FR') + ' km']);
    if (!props.track.closed) marks.push([route.length, 'Arrivée']);
    for (const [d, label] of marks) {
      const p = route.pointAt(d);
      if (!p) continue;
      const el = document.createElement('div');
      el.className = 'km-marker' + (d === 0 || d === route.length ? ' km-end' : '');
      el.textContent = label;
      kmMarkers.current.push(new maplibregl.Marker({ element: el }).setLngLat(p).addTo(m));
    }
    if (fitted.current !== props.track.id) {
      const [w, s, e, n] = route.bbox();
      m.fitBounds([[w, s], [e, n]], { padding: 60, duration: 0 });
      fitted.current = props.track.id;
    }
  }, [props.track, route, ready]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const sel = props.selection;
    (m.getSource('suggestions') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: props.suggestions.map((s) => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: s.position },
        properties: { id: s.id, type: s.type, status: s.status, pertinence: s.pertinence, selected: sel?.kind === 'suggestion' && sel.id === s.id },
      })),
    });
    (m.getSource('points') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: props.points.map((p) => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: p.position },
        properties: { id: p.id, color: p.missions[0]?.color ?? '#495057', selected: sel?.kind === 'point' && sel.id === p.id },
      })),
    });
  }, [props.suggestions, props.points, props.selection, ready]);

  // Le point sélectionné peut être déplacé à la souris.
  useEffect(() => {
    const m = map.current;
    dragMarker.current?.remove();
    dragMarker.current = null;
    if (!m || !ready || props.selection?.kind !== 'point') return;
    const p = props.points.find((x) => x.id === props.selection!.id);
    if (!p) return;
    const el = document.createElement('div');
    el.className = 'drag-handle';
    el.title = 'Glisser pour déplacer le point';
    const marker = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(p.position).addTo(m);
    marker.on('dragend', () => {
      const ll = marker.getLngLat();
      latest.current.onPointMove(p.id, [ll.lng, ll.lat]);
    });
    dragMarker.current = marker;
  }, [props.selection, props.points, ready]);

  // Centre la carte sur l'élément sélectionné depuis la liste.
  useEffect(() => {
    const m = map.current;
    const sel = props.selection;
    if (!m || !ready || !sel) return;
    const pos = sel.kind === 'point' ? props.points.find((p) => p.id === sel.id)?.position : props.suggestions.find((s) => s.id === sel.id)?.position;
    if (pos && !m.getBounds().contains(pos)) m.easeTo({ center: pos, zoom: Math.max(m.getZoom(), 16) });
  }, [props.selection, ready]);

  return <div ref={container} className="map" data-testid="map" />;
}
