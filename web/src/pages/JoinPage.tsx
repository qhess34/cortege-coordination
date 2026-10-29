// Page ouverte par un QR code ou un lien d'invitation : présente l'équipe, demande un pseudonyme, rejoint.
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../api';
import { dateTime } from '../labels';

interface Info {
  event: { name: string; startsAt: string | null };
  team: { name: string; color: string };
  kind: 'equipe' | 'individuelle'; admission: 'immediate' | 'validation'; role: 'membre' | 'responsable';
  recovery: { name: string } | null;
  state: string; message: string | null;
}

export function JoinPage({ token, onJoined }: { token: string; onJoined: () => void }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pseudonym, setPseudonym] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<Info>('/api/rejoindre/' + encodeURIComponent(token)).then(setInfo, (e) =>
      setError(e instanceof ApiError && e.status === 404 ? 'Invitation inconnue. Vérifiez le lien ou demandez-en un nouveau à votre responsable.' : e instanceof ApiError ? e.message : 'Invitation illisible.'));
  }, [token]);

  const join = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/rejoindre/' + encodeURIComponent(token), info?.recovery ? {} : { pseudonym });
      // Le lien ne sert plus : on le retire de l'adresse (historique compris), la session prend le relais.
      window.history.replaceState(null, '', '/#/moi');
      onJoined();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de rejoindre l’équipe.');
      setBusy(false);
    }
  };

  return (
    <div className="center">
      <div className="card login" data-testid="rejoindre">
        {!info && !error && <p>Chargement de l’invitation…</p>}
        {error && !info && <p className="error" role="alert">{error}</p>}
        {info && (
          <>
            <p className="muted">Vous êtes invité·e à rejoindre</p>
            <h1><span className="dot" style={{ background: info.team.color }} /> {info.team.name}</h1>
            <p>
              <b>{info.event.name}</b>
              {info.event.startsAt ? <><br /><span className="muted">{dateTime(info.event.startsAt)}</span></> : null}
            </p>
            {info.state !== 'valide' ? (
              <p className="warning" role="alert">{info.message}</p>
            ) : (
              <form className="stack" onSubmit={join}>
                {info.recovery ? (
                  <p>Récupération de l’accès de <b>{info.recovery.name}</b> sur cet appareil. Les autres appareils seront déconnectés.</p>
                ) : (
                  <label>Votre nom ou pseudonyme
                    <input value={pseudonym} onChange={(e) => setPseudonym(e.target.value)} required maxLength={60} autoComplete="nickname" autoFocus />
                  </label>
                )}
                {info.role === 'responsable' && <p className="muted small">Vous serez responsable de cette équipe.</p>}
                {info.admission === 'validation' && !info.recovery && <p className="muted small">Votre demande sera validée par un responsable avant d’accéder à l’équipe.</p>}
                {error && <p className="error" role="alert">{error}</p>}
                <button className="primary big" disabled={busy}>{info.recovery ? 'Retrouver mon accès' : 'Rejoindre l’équipe'}</button>
                <p className="muted small">Aucun compte ni mot de passe : cet appareil restera connecté pendant la manifestation.</p>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
