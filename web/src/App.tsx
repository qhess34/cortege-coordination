import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from './api';
import { EventPage } from './pages/EventPage';
import { EventsPage } from './pages/EventsPage';
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

  if (me === undefined) return <div className="center">Chargement…</div>;
  if (me === null) return <LoginPage onLogin={loadMe} />;

  const logout = async () => {
    await api.post('/api/auth/logout');
    setMe(null);
  };
  const m = route.match(/^\/evenements\/(\d+)/);
  return (
    <div className="app">
      <header className="topbar">
        <a href="#/" className="brand">Coordination de cortège</a>
        <span className="spacer" />
        <span className="muted">{me.displayName}{me.globalRole === 'admin' ? ' (administrateur)' : ''}</span>
        <button className="link" onClick={logout}>Se déconnecter</button>
      </header>
      {m ? <EventPage key={m[1]} eventId={Number(m[1])} /> : <EventsPage me={me} />}
    </div>
  );
}
