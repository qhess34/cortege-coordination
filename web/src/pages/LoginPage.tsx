import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../api';

export function LoginPage({ onLogin }: { onLogin: () => void }) {
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
    <div className="center">
      <form className="card login" onSubmit={submit}>
        <h1>Connexion</h1>
        <p className="muted">Les comptes sont créés par un administrateur. Il n'y a pas d'inscription en ligne.</p>
        <label>Identifiant<input value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" required /></label>
        <label>Mot de passe<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" disabled={busy}>Se connecter</button>
      </form>
    </div>
  );
}
