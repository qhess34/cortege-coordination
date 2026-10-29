import { useEffect, useState } from 'react';
import { ApiError, api } from '../../api';
import { dateTime } from '../../labels';
import type { HistoryEntry } from '../../types';
import type { PanelProps } from '../EventPage';

const ENTITY: Record<string, string> = {
  event: 'Événement', gpx_track: 'Parcours', osm_analysis: 'Analyse OSM', map_suggestion: 'Suggestion', mission_point: 'Point',
  team: 'Équipe', mission: 'Mission', event_membership: 'Accès',
};

export function HistoryPanel({ data }: PanelProps) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.get<HistoryEntry[]>('/api/events/' + data.event.id + '/history').then(setEntries, (e) => setError(e instanceof ApiError ? e.message : 'Erreur'));
  }, [data]);
  if (error) return <p className="muted">{error}</p>;
  if (!entries) return <p>Chargement…</p>;
  return (
    <ul className="history">
      {entries.map((e) => (
        <li key={e.id}>
          <span className="muted">{dateTime(e.at)}</span> — <b>{ENTITY[e.entity] ?? e.entity}{e.entityId ? ' #' + e.entityId : ''}</b> : {e.action.replace(/_/g, ' ')}
          {e.actor && <span className="muted"> ({e.actor})</span>}
        </li>
      ))}
    </ul>
  );
}
