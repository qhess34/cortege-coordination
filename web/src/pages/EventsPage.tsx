import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../api';
import { EVENT_STATUS, dateTime } from '../labels';
import { InstallCard } from '../components/InstallCard';
import type { EventInfo, Me } from '../types';

export function EventsPage({ me }: { me: Me }) {
  const [events, setEvents] = useState<EventInfo[] | null>(null);
  const [name, setName] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const canCreate = me.globalRole === 'admin' || me.globalRole === 'organisateur';

  useEffect(() => { void api.get<EventInfo[]>('/api/events').then(setEvents); }, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const ev = await api.post<EventInfo>('/api/events', { name, startsAt: startsAt ? new Date(startsAt).toISOString() : null });
      window.location.hash = '#/evenements/' + ev.id;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Création impossible.');
    }
  };

  return (
    <main className="page">
      <h1>Manifestations</h1>
      <InstallCard compact dismissible />
      {events === null ? <p>Chargement…</p> : events.length === 0 ? <p className="muted">Aucun événement accessible.</p> : (
        <ul className="plain event-cards">
          {events.map((ev) => (
            <li key={ev.id} className="card event-card" data-testid={'manifestation-' + ev.id}>
              <div className="grow">
                <h2>{ev.name}</h2>
                <p className="muted small">{dateTime(ev.startsAt)} · {EVENT_STATUS[ev.status]}{ev.role ? ' · ' + ev.role : ''}</p>
              </div>
              <div className="event-actions">
                <a className="button" href={'#/evenements/' + ev.id} title="Parcours, suggestions, points, équipes (ordinateur)">🗺 Planifier</a>
                <a className={'button' + (ev.status === 'en_cours' ? ' primary' : '')} href={'#/direct/' + ev.id} title="Suivi du jour J, adapté au téléphone">📱 Coordination en direct</a>
              </div>
            </li>
          ))}
        </ul>
      )}
      {canCreate && (
        <form className="card inline-form" onSubmit={create}>
          <h2>Nouvel événement</h2>
          <label>Nom<input value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} /></label>
          <label>Début prévu<input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></label>
          {error && <p className="error">{error}</p>}
          <button className="primary">Créer</button>
        </form>
      )}
    </main>
  );
}
