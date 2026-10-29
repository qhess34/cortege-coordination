// Bulle d'édition d'un point, affichée sur la carte à l'endroit du point.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, api } from '../api';
import { MISSION_STATUS, SUGGESTION_TYPES, coords, km } from '../labels';
import type { MissionPoint } from '../types';
import type { PointEdit } from './MapView';

export const POINT_TYPES = ['carrefour', 'rue_laterale', 'acces_vehicule_entrant', 'acces_pieton_cycle', 'voie_privee', 'verification', 'point_fixe', 'autre'];

interface Props {
  eventId: number;
  edit: PointEdit;
  /** Point enregistré correspondant (édition d'un point existant). */
  point: MissionPoint | null;
  onChange: (e: PointEdit) => void;
  onClose: () => void;
  /** Après enregistrement : identifiant du point. */
  onSaved: (id: number, message: string) => Promise<void>;
  onDeleted: () => Promise<void>;
}

interface Consequences { missions: { team: string; status: string }[]; suggestion: unknown }

export function PointEditor({ eventId, edit, point, onChange, onClose, onSaved, onDeleted }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Consequences | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const isNew = edit.kind === 'new';
  const moved = !!point && (point.position[0] !== edit.position[0] || point.position[1] !== edit.position[1]);
  const dirty = isNew || moved || (!!point && (point.name !== edit.name || point.type !== edit.type || point.description !== edit.description));

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, [edit.kind, edit.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const set = (patch: Partial<PointEdit>) => onChange({ ...edit, ...patch });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (isNew) {
        const created = await api.post<MissionPoint>('/api/events/' + eventId + '/points', {
          name: edit.name, type: edit.type, description: edit.description, position: edit.position,
        });
        await onSaved(created.id, 'Point ajouté.');
      } else {
        const body: Record<string, unknown> = { version: edit.version, name: edit.name, type: edit.type, description: edit.description };
        if (moved) body.position = edit.position;
        await api.patch('/api/points/' + edit.id, body);
        await onSaved(edit.id!, 'Point enregistré.');
      }
    } catch (err) {
      setError(err instanceof ApiError ? (err.status === 409 ? err.message + ' Fermez et rouvrez le point pour voir la version actuelle.' : err.message) : 'Enregistrement impossible.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (confirmed: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await api.delete('/api/points/' + edit.id + (confirmed ? '?confirm=1' : ''));
      await onDeleted();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.details) setConfirmDelete(err.details as Consequences);
      else setError(err instanceof ApiError ? err.message : 'Suppression impossible.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="point-editor" onSubmit={save} data-testid="point-editor">
      <div className="row">
        <b className="grow">{isNew ? 'Nouveau point' : 'Point #' + edit.id}</b>
        <button type="button" className="link" onClick={onClose} aria-label="Fermer">✕</button>
      </div>
      <label>Nom<input ref={nameRef} value={edit.name} onChange={(e) => set({ name: e.target.value })} required maxLength={200} /></label>
      <label>Type
        <select value={edit.type} onChange={(e) => set({ type: e.target.value })}>
          {POINT_TYPES.map((k) => <option key={k} value={k}>{SUGGESTION_TYPES[k]}</option>)}
        </select>
      </label>
      <label>Description<textarea rows={2} value={edit.description} onChange={(e) => set({ description: e.target.value })} /></label>
      <p className="muted small">
        {coords(edit.position)}{point && !moved ? ' · ' + km(point.distance) : ''}
        {moved ? ' · position modifiée' : ''}
        <br />Glissez le marqueur pour {isNew ? 'ajuster' : 'déplacer'} le point.
      </p>
      {point && point.missions.length > 0 && (
        <p className="muted small">{point.missions.map((m) => m.teamName + ' (' + (MISSION_STATUS[m.status] ?? m.status) + ')').join(', ')}</p>
      )}
      {error && <p className="error small" role="alert">{error}</p>}
      {confirmDelete ? (
        <div className="warning small">
          Point affecté : {confirmDelete.missions.map((m) => m.team).join(', ')}. Ces missions seront annulées (elles restent dans
          l’historique){confirmDelete.suggestion ? ' et la suggestion d’origine sera écartée' : ''}.
          <div className="row">
            <button type="button" className="danger" disabled={busy} onClick={() => remove(true)}>Confirmer la suppression</button>
            <button type="button" onClick={() => setConfirmDelete(null)}>Annuler</button>
          </div>
        </div>
      ) : (
        <div className="row">
          <button className="primary" disabled={busy || !dirty}>{isNew ? 'Ajouter' : 'Enregistrer'}</button>
          <button type="button" onClick={onClose}>Annuler</button>
          {!isNew && <button type="button" className="danger" disabled={busy} onClick={() => remove(false)}>Supprimer</button>}
        </div>
      )}
    </form>
  );
}
