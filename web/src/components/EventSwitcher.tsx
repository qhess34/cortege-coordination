// Barre du haut : bascule entre manifestations et création d'une nouvelle manifestation.
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, api } from '../api';
import type { EventInfo, Me } from '../types';

/** Événement de fenêtre émis quand la liste des manifestations change (création, renommage, suppression). */
export const EVENTS_CHANGED = 'cortege:manifestations';
export const notifyEventsChanged = () => window.dispatchEvent(new Event(EVENTS_CHANGED));

export function EventSwitcher({ me, currentId }: { me: Me; currentId: number | null }) {
  const [events, setEvents] = useState<EventInfo[]>([]);
  const [creating, setCreating] = useState(false);
  const canCreate = me.globalRole === 'admin' || me.globalRole === 'organisateur';

  const load = useCallback(() => { api.get<EventInfo[]>('/api/events').then(setEvents, () => setEvents([])); }, []);
  useEffect(() => {
    load();
    window.addEventListener(EVENTS_CHANGED, load);
    return () => window.removeEventListener(EVENTS_CHANGED, load);
  }, [load, currentId]);

  return (
    <div className="event-switcher">
      <select
        aria-label="Manifestation"
        value={currentId ?? ''}
        onChange={(e) => { window.location.hash = e.target.value ? '#/evenements/' + e.target.value : '#/'; }}
      >
        <option value="">Toutes les manifestations…</option>
        {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
      </select>
      {canCreate && <button className="on-dark" onClick={() => setCreating(true)}>+ Nouvelle manifestation</button>}
      {creating && <NewEventDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewEventDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [areaName, setAreaName] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { ref.current?.showModal(); }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const ev = await api.post<EventInfo>('/api/events', { name, areaName, startsAt: startsAt ? new Date(startsAt).toISOString() : null });
      notifyEventsChanged();
      onClose();
      window.location.hash = '#/evenements/' + ev.id;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Création impossible.');
    }
  };

  return (
    <dialog ref={ref} className="dialog" onClose={onClose} aria-label="Nouvelle manifestation">
      <form className="stack" onSubmit={submit}>
        <h2>Nouvelle manifestation</h2>
        <label>Nom<input value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} autoFocus /></label>
        <label>Début prévu<input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></label>
        <label>Zone géographique<input value={areaName} onChange={(e) => setAreaName(e.target.value)} maxLength={200} /></label>
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button className="primary">Créer</button>
          <button type="button" onClick={onClose}>Annuler</button>
        </div>
      </form>
    </dialog>
  );
}
