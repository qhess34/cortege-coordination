import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from './api';
import { EventSwitcher } from './components/EventSwitcher';
import { FieldView } from './components/FieldView';
import { EventPage } from './pages/EventPage';
import { AdminPage } from './pages/AdminPage';
import { HelpPage } from './pages/HelpPage';
import { EventsPage } from './pages/EventsPage';
import { JoinPage } from './pages/JoinPage';
import { LinkLoginPage } from './pages/LinkLoginPage';
import { LiveCoordPage } from './pages/LiveCoordPage';
import { ConnectDevice } from './components/ConnectDevice';
import { ParticipantPage } from './pages/ParticipantPage';
import { RoadbookPage } from './pages/RoadbookPage';
import { LoginPage } from './pages/LoginPage';
import type { Me } from './types';

/** Routage minimal par fragment d'URL : #/ (événements), #/evenements/<id>. */
function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash.slice(1) || '/');
  useEffect(() => {
    const f = () => setHash(window.location.hash.slice(1) || '/');
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return hash;
}

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const route = useHashRoute();

  const loadMe = useCallback(async () => {
    try {
      setMe(await api.get<Me>('/api/auth/me'));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setMe(null);
      else throw e;
    }
  }, []);
  useEffect(() => { void loadMe(); }, [loadMe]);

  // La session du navigateur peut changer dans un autre onglet (déconnexion, autre compte, lien d'invitation
  // ouvert) : au retour sur l'onglet, on revérifie pour ne pas agir sous une identité périmée.
  const meId = me?.id;
  useEffect(() => {
    if (meId === undefined) return;
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      api.get<Me>('/api/auth/me').then((m) => { if (m.id !== meId) window.location.reload(); }, (e) => {
        if (e instanceof ApiError && e.status === 401) setMe(null);
      });
    };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => { document.removeEventListener('visibilitychange', check); window.removeEventListener('focus', check); };
  }, [meId]);

  // Lien d'invitation (/rejoindre/<jeton>) : accessible sans connexion.
  const joinToken = window.location.pathname.match(/^\/rejoindre\/([A-Za-z0-9_-]+)$/)?.[1];
  if (joinToken) return <JoinPage token={joinToken} />;
  // Lien de connexion d'un compte (/connexion/<jeton>).
  const linkToken = window.location.pathname.match(/^\/connexion\/([A-Za-z0-9_-]+)$/)?.[1];
  if (linkToken) return <LinkLoginPage token={linkToken} />;

  if (me === undefined) return <div className="center">Chargement…</div>;
  if (me === null) return <LoginPage onLogin={loadMe} />;
  // Participant (sans compte classique) : seulement son espace d'équipe.
  if (me.accountType === 'participant') return <div className="app"><ParticipantPage onLogout={() => setMe(null)} /></div>;

  const logout = async () => {
    await api.post('/api/auth/logout');
    setMe(null);
  };
  // Vue terrain d'une équipe dont le compte fait partie (#/terrain/<équipe>), plein écran comme sur téléphone.
  const field = route.match(/^\/terrain\/(\d+)$/);
  if (field) {
    return (
      <div className="app">
        <FieldView key={field[1]} teamId={Number(field[1])} header={<button className="link small" onClick={() => (history.length > 1 ? history.back() : (location.hash = '#/'))}>← Retour à l’organisation</button>} />
      </div>
    );
  }
  // Coordination en direct, pensée pour le téléphone (#/direct/<manifestation>).
  const direct = route.match(/^\/direct\/(\d+)$/);
  if (direct) return <div className="app"><LiveCoordPage key={direct[1]} eventId={Number(direct[1])} /></div>;
  const m = route.match(/^\/evenements\/(\d+)/);
  // #/evenements/<id>/roadbook (manifestation) ou #/evenements/<id>/roadbook/equipe/<id>
  const rb = route.match(/^\/evenements\/(\d+)\/roadbook(\/equipe\/(\d+))?$/);
  return (
    <div className="app">
      <header className="topbar">
        <a href="#/" className="brand">Coordination de cortège</a>
        <EventSwitcher me={me} currentId={m ? Number(m[1]) : null} />
        <span className="spacer" />
        <ConnectDevice />
        <a href="#/aide">Aide</a>
        {me.globalRole === 'admin' && <a href="#/admin">Comptes</a>}
        <span className="muted topbar-name">{me.displayName}{me.globalRole === 'admin' ? ' (administrateur)' : ''}</span>
        <button className="link" onClick={logout}>Se déconnecter</button>
      </header>
      {rb ? <RoadbookPage key={route} eventId={Number(rb[1])} teamId={rb[3] ? Number(rb[3]) : null} />
        : m ? <EventPage key={m[1]} eventId={Number(m[1])} />
        : route === '/admin' && me.globalRole === 'admin' ? <AdminPage meId={me.id} />
        : route === '/aide' ? <HelpPage />
        : <EventsPage me={me} />}
    </div>
  );
}
