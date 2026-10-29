import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MlMap, MapMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 charge son worker depuis un fichier séparé : on le fait empaqueter par Vite.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Route } from '../../../server/src/geo/route';
import { BASEMAPS, DEFAULT_BASEMAP, FALLBACK_BASEMAP } from '../basemaps';
import { loadVectorBasemap } from './vectorBasemap';
import type { MissionPoint, Position, Suggestion, Track } from '../types';

maplibregl.setWorkerUrl(workerUrl);

export type Selection = { kind: 'suggestion' | 'point'; id: number } | null;

/** Point en cours d'édition sur la carte : nouveau (brouillon) ou existant, avec ses valeurs non enregistrées. */
export interface PointEdit {
  kind: 'new' | 'existing';
  id?: number;
  version?: number;
  position: Position;
  name: string;
  type: string;
  description: string;
}

interface Props {
  track: Track | null;
  suggestions: Suggestion[];
  points: MissionPoint[];
  selection: Selection;
  addMode: boolean;
  onSelect: (s: Selection) => void;
  onMapClick: (p: Position) => void;
  /** Le point en cours d'édition a été glissé à une nouvelle position (non enregistrée). */
  onEditMove: (p: Position) => void;
  /** Édition en cours : le marqueur reflète les valeurs saisies avant enregistrement. */
  edit: PointEdit | null;
  /** Bulle affichée sur la carte (menu, fiche de suggestion, édition d'un point). */
  popup: { key: string; position: Position; content: ReactNode } | null;
  /** Le fond vectoriel n'a pas pu être chargé (le fond raster de secours est affiché). */
  onBasemapError?: (message: string) => void;
  /** Demande de centrage (n change à chaque demande). */
  focus?: { position: Position; n: number } | null;
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
        sources: Object.fromEntries(BASEMAPS.filter((b) => b.tiles).map((b) => [
          'fond-' + b.id,
          { type: 'raster' as const, tiles: [b.tiles!], tileSize: 256, maxzoom: b.maxzoom, attribution: b.attribution },
        ])),
        layers: BASEMAPS.filter((b) => b.tiles).map((b) => ({
          id: 'fond-' + b.id, type: 'raster' as const, source: 'fond-' + b.id,
          layout: { visibility: 'none' as const },
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
      const hits = m.queryRenderedFeatures(e.point, { layers: ['suggestions'] });
      const f = hits[0];
      const clicked: Position = [e.lngLat.lng, e.lngLat.lat];
      if (f && !latest.current.addMode) latest.current.onSelect({ kind: 'suggestion', id: Number(f.properties.id) });
      else latest.current.onMapClick(clicked);
    });
    m.on('mouseenter', 'suggestions', () => { m.getCanvas().style.cursor = 'pointer'; });
    m.on('mouseleave', 'suggestions', () => { m.getCanvas().style.cursor = latest.current.addMode ? 'crosshair' : ''; });
    map.current = m;
    return () => { m.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    if (map.current) map.current.getCanvas().style.cursor = props.addMode ? 'crosshair' : '';
  }, [props.addMode]);

  // Fond de carte : un seul visible. Le fond vectoriel est chargé à la première demande ; en cas d'échec,
  // on affiche le plan raster de secours.
  const [vectorFailed, setVectorFailed] = useState(false);
  const vectorLoad = useRef<Promise<string[]> | null>(null);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    let wanted = BASEMAPS.find((b) => b.id === props.basemap) ?? BASEMAPS.find((b) => b.id === DEFAULT_BASEMAP)!;
    if (wanted.style && vectorFailed) wanted = BASEMAPS.find((b) => b.id === FALLBACK_BASEMAP)!;
    for (const b of BASEMAPS) if (b.tiles) m.setLayoutProperty('fond-' + b.id, 'visibility', b.id === wanted.id ? 'visible' : 'none');
    const showVector = (on: boolean) => vectorLoad.current?.then((ids) => {
      for (const id of ids) if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    }, () => undefined);
    if (wanted.style) {
      vectorLoad.current ??= loadVectorBasemap(m, wanted.style, 'track-casing');
      vectorLoad.current.then(() => {
        // Le sprite du style vectoriel remplace celui de la carte : on remet nos images si besoin.
        if (!m.hasImage('arrow')) m.addImage('arrow', arrowImage());
        void showVector(true);
      }, (e: Error) => {
        setVectorFailed(true);
        latest.current.onBasemapError?.('Plan vectoriel indisponible (' + e.message + ') : plan OSM en images affiché.');
      });
    } else {
      void showVector(false);
    }
  }, [props.basemap, ready, vectorFailed]);

  const pnx = props.panoramax;
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !pnx) return;
    if (m.getLayer('panoramax-sequences')) m.setLayoutProperty('panoramax-sequences', 'visibility', pnx.enabled ? 'visible' : 'none');
    const features = [];
    if (pnx.clicked) features.push({ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: pnx.clicked }, properties: { kind: 'clic' } });
    if (pnx.photo) features.push({ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: pnx.photo }, properties: { kind: 'photo' } });
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
  }, [props.suggestions, props.selection, ready]);

  // Points de mission : marqueurs HTML (étiquette du nom, glisser-déposer). Le point en cours d'édition
  // affiche les valeurs saisies, avant enregistrement : ce qu'on voit est ce qui sera enregistré.
  const markers = useRef(new Map<string, { marker: maplibregl.Marker; el: HTMLDivElement }>());
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const edit = props.edit;
    const wanted = new Map<string, { position: Position; name: string; color: string; selected: boolean; draggable: boolean; draft: boolean; id: number | null }>();
    for (const p of props.points) {
      const editing = edit?.kind === 'existing' && edit.id === p.id;
      wanted.set('p' + p.id, {
        position: editing ? edit.position : p.position,
        name: editing ? edit.name : p.name,
        color: p.missions[0]?.color ?? '#495057',
        selected: editing || (props.selection?.kind === 'point' && props.selection.id === p.id),
        draggable: editing,
        draft: false,
        id: p.id,
      });
    }
    if (edit?.kind === 'new') {
      wanted.set('draft', { position: edit.position, name: edit.name, color: '#ffffff', selected: true, draggable: true, draft: true, id: null });
    }
    for (const [key, { marker }] of markers.current) {
      if (!wanted.has(key)) {
        marker.remove();
        markers.current.delete(key);
      }
    }
    for (const [key, w] of wanted) {
      let entry = markers.current.get(key);
      if (!entry) {
        const el = document.createElement('div');
        el.innerHTML = '<span class="point-dot"></span><span class="point-label"></span>';
        const marker = new maplibregl.Marker({ element: el }).setLngLat(w.position).addTo(m);
        // Un clic sur un marqueur ne doit pas être traité comme un clic sur la carte.
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const id = Number(el.dataset.id);
          if (!el.dataset.id || latest.current.addMode) return;
          latest.current.onSelect({ kind: 'point', id });
        });
        marker.on('drag', () => {
          const ll = marker.getLngLat();
          popup.current?.setLngLat(ll);
        });
        marker.on('dragend', () => {
          const ll = marker.getLngLat();
          latest.current.onEditMove([ll.lng, ll.lat]);
        });
        entry = { marker, el };
        markers.current.set(key, entry);
      }
      const { marker, el } = entry;
      // classList et non className : MapLibre pose ses propres classes (positionnement) sur l'élément.
      el.classList.add('point-marker');
      el.classList.toggle('selected', w.selected);
      el.classList.toggle('draft', w.draft);
      el.classList.toggle('draggable', w.draggable);
      el.dataset.id = w.id === null ? '' : String(w.id);
      el.title = w.draggable ? 'Glisser pour déplacer le point' : w.name;
      (el.firstChild as HTMLElement).style.background = w.color;
      (el.lastChild as HTMLElement).textContent = w.name;
      marker.setLngLat(w.position);
      marker.setDraggable(w.draggable);
    }
  }, [props.points, props.edit, props.selection, ready]);

  // Bulle d'édition ancrée au point, dont le contenu est rendu par React.
  const popup = useRef<maplibregl.Popup | null>(null);
  const [popupNode, setPopupNode] = useState<HTMLDivElement | null>(null);
  const popupKey = props.popup?.key ?? null;
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !popupKey) return;
    const node = document.createElement('div');
    const p = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 18, maxWidth: '340px', className: 'point-popup' })
      .setDOMContent(node)
      .setLngLat(latest.current.popup!.position)
      .addTo(m);
    popup.current = p;
    setPopupNode(node);
    return () => {
      p.remove();
      popup.current = null;
      setPopupNode(null);
    };
  }, [popupKey, ready]);
  useEffect(() => {
    if (props.popup) popup.current?.setLngLat(props.popup.position);
  }, [props.popup?.position]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !props.focus) return;
    m.easeTo({ center: props.focus.position, zoom: Math.max(m.getZoom(), 17) });
  }, [props.focus?.n, ready]);

  // Centre la carte sur l'élément sélectionné depuis la liste.
  useEffect(() => {
    const m = map.current;
    const sel = props.selection;
    if (!m || !ready || !sel) return;
    const pos = sel.kind === 'point' ? props.points.find((p) => p.id === sel.id)?.position : props.suggestions.find((s) => s.id === sel.id)?.position;
    if (pos && !m.getBounds().contains(pos)) m.easeTo({ center: pos, zoom: Math.max(m.getZoom(), 16) });
  }, [props.selection, ready]);

  return (
    <>
      <div ref={container} className="map" data-testid="map" />
      {popupNode && props.popup ? createPortal(props.popup.content, popupNode) : null}
    </>
  );
}
