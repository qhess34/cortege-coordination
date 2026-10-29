// Espace du participant (en attendant l'application de terrain du lot 3) : son équipe, ses consignes, ses missions.
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../api';
import { FieldView } from '../components/FieldView';
import type { SpaceEvent, SpaceMission, SpaceTeam } from '../components/TeamSpace';
import { dateTime } from '../labels';

interface Moi {
  participant: { id: number; displayName: string };
  event: SpaceEvent;
  team: SpaceTeam | null;
  pendingTeam: string | null;
  missions: SpaceMission[];
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

  const leave = async () => {
    if (!window.confirm('Fermer l’accès participant sur cet appareil ? Pour revenir dans l’équipe, il faudra un nouveau lien (lien de récupération donné par un responsable).')) return;
    await api.post('/api/auth/logout').catch(() => undefined);
    onLogout();
  };

  if (!moi) return <div className="center">{error ?? 'Chargement…'}</div>;
  // Membre admis : la vue terrain (mission, messages, incidents).
  if (moi.team) {
    return (
      <>
        <FieldView teamId={moi.team.id} onUnauthorized={() => void load()} />
        <footer className="field-footer"><button className="link small" onClick={() => void leave()}>Se connecter avec un compte d’organisation</button></footer>
      </>
    );
  }
  return (
    <main className="page participant" data-testid="espace-participant">
      <header>
        <p className="muted">{moi.event.name}{moi.event.startsAt ? ' — ' + dateTime(moi.event.startsAt) : ''}</p>
        <h1>Bienvenue {moi.participant.displayName}</h1>
        <p className="muted small">
          {syncedAt ? ' · mis à jour à ' + syncedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : ''}
        </p>
        {error && <p className="warning" role="alert">{error}</p>}
      </header>

      {!moi.team && moi.pendingTeam && (
        <p className="warning">Votre demande pour rejoindre « {moi.pendingTeam} » attend la validation d’un responsable. Cette page se met à jour toute seule.</p>
      )}
      {!moi.team && !moi.pendingTeam && <p className="warning">Vous n’êtes plus membre d’aucune équipe.</p>}

      <p className="muted small">L’application de terrain (navigation, confirmations, messages) arrive dans une prochaine version.</p>
      <div className="row">
        <button onClick={() => void load()}>Actualiser</button>
        <button onClick={() => void leave()}>Se connecter avec un compte d’organisation</button>
      </div>
    </main>
  );
}
