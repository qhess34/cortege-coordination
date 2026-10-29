// Accueil d'un compte « membre » : ses équipes (une seule : ouverture directe de la vue terrain).
import { useEffect, useState } from 'react';
import { ApiError, api } from '../api';
import { InstallCard } from '../components/InstallCard';
import { EVENT_STATUS, TEAM_KIND, dateTime } from '../labels';
import type { Me, MyTeam } from '../types';

export function MemberHome({ me, autoOpen }: { me: Me; autoOpen: boolean }) {
  const [teams, setTeams] = useState<MyTeam[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.get<MyTeam[]>('/api/moi/equipes').then((t) => {
      setTeams(t);
      const open = t.filter((x) => !x.closed);
      // Une seule équipe : on y va directement (le lien « Mes équipes » ramène ici sans redirection).
      if (autoOpen && open.length === 1) window.location.replace('#/terrain/' + open[0]!.id);
    }, (e) => setError(e instanceof ApiError ? e.message : 'Chargement impossible.'));
  }, [autoOpen]);

  return (
    <main className="page member-home" data-testid="mes-equipes">
      <h1>Bonjour {me.displayName}</h1>
      <InstallCard compact dismissible />
      {error && <p className="error">{error}</p>}
      {teams === null && !error && <p>Chargement…</p>}
      {teams?.length === 0 && (
        <p className="warning">Vous n’êtes membre d’aucune équipe pour l’instant. L’organisation vous ajoutera à une équipe : cette page se mettra
          alors à jour.</p>
      )}
      <ul className="plain event-cards">
        {teams?.map((t) => (
          <li key={t.id} className={'card event-card' + (t.closed ? ' disabled' : '')} style={{ borderLeft: '6px solid ' + t.color }}>
            <div className="grow">
              <h2>{t.name}{t.role === 'responsable' ? ' (responsable)' : ''}</h2>
              <p className="muted small">{t.event.name} · {dateTime(t.event.startsAt)} · {EVENT_STATUS[t.event.status] ?? t.event.status}
                {t.kind !== 'points' ? ' · ' + TEAM_KIND[t.kind] : ''}{t.closed ? ' · équipe désactivée' : ''}</p>
            </div>
            <a className="button primary" href={'#/terrain/' + t.id}>Ouvrir</a>
          </li>
        ))}
      </ul>
      <nav className="row small"><a href="#/profil">Mon profil</a><a href="#/aide">Aide</a></nav>
    </main>
  );
}
