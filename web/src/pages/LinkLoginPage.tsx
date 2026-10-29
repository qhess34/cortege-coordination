// Page ouverte par un lien de connexion (/connexion/<jeton>) : confirme, puis ouvre la session sur cet appareil.
import { useEffect, useState } from 'react';
import { ApiError, api } from '../api';

export function LinkLoginPage({ token }: { token: string }) {
  const [info, setInfo] = useState<{ state: string; displayName: string; message: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get<{ state: string; displayName: string; message: string | null }>('/api/auth/lien/' + encodeURIComponent(token)).then(setInfo, (e) =>
      setError(e instanceof ApiError && e.status === 404 ? 'Lien de connexion inconnu.' : 'Lien illisible.'));
  }, [token]);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/lien/' + encodeURIComponent(token));
      // Vrai rechargement : le jeton quitte l'adresse et l'historique ; la page d'accueil est servie normalement.
      window.location.replace('/#/');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Connexion impossible.');
      setBusy(false);
    }
  };

  return (
    <div className="center">
      <div className="card login stack" data-testid="lien-connexion">
        <h1>Connexion</h1>
        {!info && !error && <p>Vérification du lien…</p>}
        {info && info.state === 'valide' && (
          <>
            <p>Se connecter en tant que <b>{info.displayName}</b> sur cet appareil ?</p>
            <button className="primary big" disabled={busy} onClick={() => void connect()}>Se connecter</button>
            <p className="muted small">Ce lien ne servira qu’une fois.</p>
          </>
        )}
        {info && info.state !== 'valide' && <p className="warning" role="alert">{info.message}</p>}
        {error && <p className="error" role="alert">{error}</p>}
        <a href="/" className="small">Aller à la page de connexion</a>
      </div>
    </div>
  );
}
