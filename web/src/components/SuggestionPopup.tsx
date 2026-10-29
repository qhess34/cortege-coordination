// Bulle d'une suggestion OSM sur la carte : résumé, et décisions (valider, écarter) sans quitter la carte.
import { useEffect, useState } from 'react';
import { ApiError, api } from '../api';
import { haversine } from '../../../server/src/geo/route';
import { FLOW, MOTOR, PERTINENCE, SUGGESTION_STATUS, SUGGESTION_TYPES, km } from '../labels';
import type { Position, Suggestion } from '../types';

interface Props {
  s: Suggestion;
  /** Position où la suggestion a été glissée (validation à cet endroit), ou null. */
  moveTo: Position | null;
  onResetMove: () => void;
  canEdit: boolean;
  onPhotos: () => void;
  onDetails: () => void;
  onClose: () => void;
  /** Après une décision : message, et point créé le cas échéant. */
  onDone: (message: string, pointId?: number) => Promise<void>;
}

export function SuggestionPopup({ s, moveTo, onResetMove, canEdit, onPhotos, onDetails, onClose, onDone }: Props) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Action impossible.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="point-editor" data-testid="suggestion-popup">
      <div className="row">
        <b className="grow">{SUGGESTION_TYPES[s.type] ?? s.type}</b>
        <button type="button" className="link" onClick={onClose} aria-label="Fermer">✕</button>
      </div>
      <p className="small">
        {s.routeNames[0] ?? 'Voie sans nom'} · {km(s.distance)} · pertinence {PERTINENCE[s.pertinence]?.toLowerCase()} · {SUGGESTION_STATUS[s.status]}
      </p>
      <ul className="small compact">
        {s.branches.map((b) => (
          <li key={b.wayId}>{b.name ?? 'voie sans nom'} ({b.highway}, {MOTOR[b.motor]}{b.motor !== 'non' ? ', ' + FLOW[b.flow] : ''})</li>
        ))}
      </ul>
      {s.uncertainties.length > 0 && <p className="small warning">{s.uncertainties.length} incertitude(s) : voir le détail.</p>}
      <p className="muted small">
        Suggestion issue d’OpenStreetMap, à vérifier sur place.
        {canEdit && s.status === 'a_examiner' && !moveTo ? ' Glissez-la sur la carte pour la valider à un autre endroit.' : ''}
      </p>
      {error && <p className="error small" role="alert">{error}</p>}
      {canEdit && s.status === 'a_examiner' && moveTo && (
        <div className="stack">
          <p className="small warning">Déplacée de {Math.round(haversine(s.position, moveTo))} m par rapport à la position OSM.</p>
          <div className="row">
            <button className="primary" disabled={busy} onClick={() => act(async () => {
              const r = await api.post<{ pointId: number }>('/api/suggestions/' + s.id + '/validate', { position: moveTo });
              await onDone('Suggestion validée à la position choisie : point de mission créé.', r.pointId);
            })}>Valider à cette position</button>
            <button disabled={busy} onClick={onResetMove}>Remettre en place</button>
          </div>
        </div>
      )}
      {canEdit && s.status === 'a_examiner' && !moveTo && (
        <>
          <div className="row">
            <button className="primary" disabled={busy} onClick={() => act(async () => {
              const r = await api.post<{ pointId: number }>('/api/suggestions/' + s.id + '/validate');
              await onDone('Suggestion validée : point de mission créé.', r.pointId);
            })}>Valider</button>
            <button disabled={busy} onClick={() => act(async () => {
              await api.post('/api/suggestions/' + s.id + '/dismiss', { reason: reason || undefined });
              await onDone('Suggestion écartée.');
            })}>Écarter</button>
          </div>
          <input placeholder="Motif d’exclusion (facultatif)" value={reason} onChange={(e) => setReason(e.target.value)} />
        </>
      )}
      {canEdit && s.status === 'ecartee' && (
        <button disabled={busy} onClick={() => act(async () => {
          await api.post('/api/suggestions/' + s.id + '/reopen');
          await onDone('Suggestion remise à examiner.');
        })}>Réexaminer</button>
      )}
      <div className="row">
        <button onClick={onPhotos}>📷 Photos</button>
        <button onClick={onDetails}>Détails</button>
      </div>
    </div>
  );
}
