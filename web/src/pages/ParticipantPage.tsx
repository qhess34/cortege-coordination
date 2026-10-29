// Espace du participant (en attendant l'application de terrain du lot 3) : son équipe, ses consignes, ses missions.
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../api';
import { MISSION_STATUS, SUGGESTION_TYPES, dateTime, km } from '../labels';
import type { Position } from '../types';

interface Moi {
  participant: { id: number; displayName: string };
  event: { id: number; name: string; startsAt: string | null; endsAt: string | null; instructions: string; status: string };
  team: { id: number; name: string; color: string; instructions: string; role: string; leaderName: string | null; closed: boolean } | null;
  pendingTeam: string | null;
  missions: { order: number; status: string; instructions: string; point: { name: string; type: string; description: string; position: Position; distance: number | null } }[];
}

export function ParticipantPage({ onLogout }: { onLogout: () => void }) {
  const [moi, setMoi] = useState<Moi | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      setMoi(await api.get<Moi>('/api/moi'));
      setSyncedAt(new Date());
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onLogout();
      else setError('Connexion impossible : les informations affichées peuvent être anciennes.');
    }
  }, [onLogout]);
  useEffect(() => {
    void load();
    // En attente de validation : on vérifie régulièrement.
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  if (!moi) return <div className="center">{error ?? 'Chargement…'}</div>;
  return (
    <main className="page participant" data-testid="espace-participant">
      <header>
        <p className="muted">{moi.event.name}{moi.event.startsAt ? ' — ' + dateTime(moi.event.startsAt) : ''}</p>
        <h1>{moi.team ? <><span className="dot" style={{ background: moi.team.color }} /> {moi.team.name}</> : 'Bienvenue ' + moi.participant.displayName}</h1>
        <p className="muted small">
          {moi.participant.displayName}{moi.team?.role === 'responsable' ? ' (responsable)' : ''}
          {syncedAt ? ' · mis à jour à ' + syncedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : ''}
        </p>
        {error && <p className="warning" role="alert">{error}</p>}
      </header>

      {!moi.team && moi.pendingTeam && (
        <p className="warning">Votre demande pour rejoindre « {moi.pendingTeam} » attend la validation d’un responsable. Cette page se met à jour toute seule.</p>
      )}
      {!moi.team && !moi.pendingTeam && <p className="warning">Vous n’êtes plus membre d’aucune équipe.</p>}

      {moi.team && (
        <>
          {moi.team.leaderName && <p>Responsable : <b>{moi.team.leaderName}</b></p>}
          {moi.event.instructions && <section className="card"><h2>Consignes générales</h2><p className="pre">{moi.event.instructions}</p></section>}
          {moi.team.instructions && <section className="card"><h2>Consignes de l’équipe</h2><p className="pre">{moi.team.instructions}</p></section>}
          <section className="card">
            <h2>Missions de l’équipe</h2>
            {moi.missions.length === 0 ? <p className="muted">Aucune mission pour l’instant.</p> : (
              <ol className="missions">
                {moi.missions.map((m) => (
                  <li key={m.order}>
                    <b>{m.point.name}</b> <span className="muted">— {SUGGESTION_TYPES[m.point.type] ?? m.point.type}, {km(m.point.distance)}, {MISSION_STATUS[m.status] ?? m.status}</span>
                    {m.instructions && <p className="pre">Consignes : {m.instructions}</p>}
                    <p className="small">
                      <a href={'https://www.openstreetmap.org/?mlat=' + m.point.position[1] + '&mlon=' + m.point.position[0] + '#map=18/' + m.point.position[1] + '/' + m.point.position[0]} target="_blank" rel="noreferrer">Voir sur une carte</a>
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
      <p className="muted small">L’application de terrain (navigation, confirmations, messages) arrive dans une prochaine version.</p>
      <button onClick={() => void load()}>Actualiser</button>
    </main>
  );
}
