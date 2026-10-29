// Première page : connexion de l'organisation (identifiant et mot de passe, ou lien de connexion) et installation.
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../api';
import { InstallCard } from '../components/InstallCard';

export function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [mode, setMode] = useState<'motdepasse' | 'lien'>('motdepasse');
  const [emailLinks, setEmailLinks] = useState(false);
  useEffect(() => { api.get<{ emailLinks: boolean }>('/api/auth/options').then((o) => setEmailLinks(o.emailLinks), () => undefined); }, []);

  return (
    <div className="center login-page">
      <div className="stack login">
        <div className="card stack">
          <h1>Coordination de cortège</h1>
          <p className="muted">Les comptes sont créés par un administrateur : il n’y a pas d’inscription en ligne.</p>
          <nav className="segmented" role="tablist" aria-label="Mode de connexion">
            <button role="tab" aria-selected={mode === 'motdepasse'} onClick={() => setMode('motdepasse')}>Identifiant</button>
            <button role="tab" aria-selected={mode === 'lien'} onClick={() => setMode('lien')}>Lien de connexion</button>
          </nav>
          {mode === 'motdepasse' ? <PasswordForm onLogin={onLogin} /> : <LinkHelp emailLinks={emailLinks} />}
        </div>
        <p className="muted small member-hint">
          <b>Membre d’une équipe ?</b> Vous n’avez pas de mot de passe : ouvrez le lien de connexion que l’on vous a transmis,
          ou demandez-en un par e-mail (onglet « Lien de connexion »).
        </p>
        <InstallCard />
      </div>
    </div>
  );
}

function PasswordForm({ onLogin }: { onLogin: () => void }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/login', { login, password });
      onLogin();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Connexion impossible.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="stack" onSubmit={submit}>
      <label>Identifiant<input value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" autoCapitalize="none" required /></label>
      <label>Mot de passe<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary big" disabled={busy}>Se connecter</button>
    </form>
  );
}

function LinkHelp({ emailLinks }: { emailLinks: boolean }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const send = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      setSent((await api.post<{ message: string }>('/api/auth/lien-email', { email })).message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Envoi impossible.');
    }
  };
  return (
    <div className="stack">
      {emailLinks && (
        sent ? <p className="warning" role="status">{sent}</p> : (
          <form className="stack" onSubmit={send}>
            <label>Recevoir un lien par e-mail
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="votre adresse e-mail" autoComplete="email" required />
            </label>
            {error && <p className="error" role="alert">{error}</p>}
            <button className="primary big">Envoyer le lien</button>
          </form>
        )
      )}
      <div className="small">
        <p><b>Déjà connecté sur un autre appareil ?</b> Sur celui-ci, ouvrez le menu <b>📱 Connecter un appareil</b> et scannez
          le QR code avec ce téléphone : vous serez connecté sans mot de passe.</p>
        <p><b>Lien reçu de l’organisation ?</b> Ouvrez-le simplement sur cet appareil.</p>
        <p className="muted">Un lien de connexion ne sert qu’une fois et expire rapidement. Ne le transmettez à personne.</p>
      </div>
    </div>
  );
}
