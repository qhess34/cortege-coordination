import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../api';
import { EVENT_STATUS, dateTime } from '../labels';
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
      <h1>Événements</h1>
      {events === null ? <p>Chargement…</p> : events.length === 0 ? <p className="muted">Aucun événement accessible.</p> : (
        <table className="table">
          <thead><tr><th>Nom</th><th>Début</th><th>Statut</th><th>Votre rôle</th></tr></thead>
          <tbody>
            {events.map((ev) => (
              <tr key={ev.id}>
                <td><a href={'#/evenements/' + ev.id}>{ev.name}</a></td>
                <td>{dateTime(ev.startsAt)}</td>
                <td>{EVENT_STATUS[ev.status]}</td>
                <td>{ev.role}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
