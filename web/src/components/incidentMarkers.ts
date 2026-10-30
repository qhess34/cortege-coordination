// Incidents en cours sur une carte de l'organisation : 🆘 pour une demande d'aide, ⚠ pour les autres ; clignotant tant
// que personne ne l'a pris en charge. Lieu : position signalée, sinon le point de la mission concernée.
import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap } from 'maplibre-gl';
import type { Position } from '../types';

export interface MapIncident {
  id: number; position: Position; category: string; categoryLabel: string; status: string; priority: string;
  pointName: string | null; teamName: string | null; createdAt: string;
}

/** Synchronise les marqueurs avec la liste des incidents (création, mise à jour, retrait). */
export function syncIncidentMarkers(map: MlMap, markers: Map<number, maplibregl.Marker>, incidents: MapIncident[]): void {
  const seen = new Set<number>();
  for (const i of incidents) {
    seen.add(i.id);
    let mk = markers.get(i.id);
    if (!mk) {
      const el = document.createElement('div');
      el.innerHTML = '<span class="incident-icon"></span><span class="incident-label"></span>';
      mk = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(i.position).addTo(map);
      markers.set(i.id, mk);
    }
    const el = mk.getElement();
    const sos = i.category === 'aide';
    el.className = 'incident-marker' + (sos ? ' sos' : '') + (i.status === 'ouvert' ? ' ouvert' : '');
    el.dataset.testid = 'incident-carte-' + i.id;
    el.querySelector('.incident-icon')!.textContent = sos ? '🆘' : '⚠';
    el.querySelector('.incident-label')!.textContent = (sos ? 'SOS' : i.categoryLabel) + (i.pointName ? ' · ' + i.pointName : '');
    el.title = i.categoryLabel + (i.teamName ? ' — ' + i.teamName : '') + (i.pointName ? ' · ' + i.pointName : '') +
      ' — ' + (i.status === 'ouvert' ? 'non pris en charge' : 'pris en charge') + ' — ' +
      new Date(i.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    mk.setLngLat(i.position);
  }
  for (const [id, mk] of markers) if (!seen.has(id)) { mk.remove(); markers.delete(id); }
}

/** Incidents non résolus et localisés, au format des cartes. */
export function toMapIncidents(list: { id: number; position?: Position | null; category: string; status: string; priority: string; pointName: string | null; teamName?: string | null; createdAt: string }[],
  labels: Record<string, string>): MapIncident[] {
  return list.filter((i) => i.status !== 'resolu' && i.position).map((i) => ({
    id: i.id, position: i.position!, category: i.category, categoryLabel: labels[i.category] ?? i.category, status: i.status, priority: i.priority,
    pointName: i.pointName, teamName: i.teamName ?? null, createdAt: i.createdAt,
  }));
}
