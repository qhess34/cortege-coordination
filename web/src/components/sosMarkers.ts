// SOS en cours sur une carte de l'organisation : 🆘 clignotant tant qu'il n'est pas résolu.
// Lieu : position signalée, sinon le point de la mission concernée.
import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap } from 'maplibre-gl';
import type { Position } from '../types';

export interface MapSos {
  id: number; position: Position; type: string; pointName: string | null; teamName: string | null; createdAt: string;
}

/** Synchronise les marqueurs avec la liste des SOS (création, mise à jour, retrait). */
export function syncSosMarkers(map: MlMap, markers: Map<number, maplibregl.Marker>, list: MapSos[]): void {
  const seen = new Set<number>();
  for (const s of list) {
    seen.add(s.id);
    let mk = markers.get(s.id);
    if (!mk) {
      const el = document.createElement('div');
      el.innerHTML = '<span class="incident-icon"></span><span class="incident-label"></span>';
      mk = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(s.position).addTo(map);
      markers.set(s.id, mk);
    }
    const el = mk.getElement();
    el.className = 'incident-marker sos ouvert';
    el.dataset.testid = 'sos-carte-' + s.id;
    el.querySelector('.incident-icon')!.textContent = '🆘';
    el.querySelector('.incident-label')!.textContent = s.type + (s.pointName ? ' · ' + s.pointName : '');
    el.title = s.type + (s.teamName ? ' — ' + s.teamName : '') + (s.pointName ? ' · ' + s.pointName : '') +
      ' — ' + new Date(s.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    mk.setLngLat(s.position);
  }
  for (const [id, mk] of markers) if (!seen.has(id)) { mk.remove(); markers.delete(id); }
}

/** SOS non résolus et localisés, au format des cartes. */
export function toMapSos(list: { id: number; position?: Position | null; type: string; status: string; pointName: string | null; teamName?: string | null; createdAt: string }[]): MapSos[] {
  return list.filter((s) => s.status !== 'resolu' && s.position).map((s) => ({
    id: s.id, position: s.position!, type: s.type, pointName: s.pointName, teamName: s.teamName ?? null, createdAt: s.createdAt,
  }));
}
