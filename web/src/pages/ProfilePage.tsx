// Profil du compte : prénom, nom, adresse e-mail (pour recevoir un lien de connexion), appareils, déconnexion.
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../api';
import { ConnectDevice } from '../components/ConnectDevice';
import { InstallCard } from '../components/InstallCard';
import { dateTime } from '../labels';

interface Profile { firstName: string; lastName: string; email: string | null; displayName: string; login: string | null; expiresAt: string | null }

export function ProfilePage({ onSaved, onLogout }: { onSaved: () => void; onLogout: () => void }) {
  const [p, setP] = useState<Profile | null>(null);
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '' });
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  useEffect(() => {
    api.get<Profile>('/api/moi/profil').then((x) => { setP(x); setForm({ firstName: x.firstName, lastName: x.lastName, email: x.email ?? '' }); });
  }, []);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.patch('/api/moi/profil', { firstName: form.firstName, lastName: form.lastName, email: form.email.trim() || null });
      setMessage({ kind: 'ok', text: 'Profil enregistré.' });
      onSaved();
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof ApiError ? err.message : 'Enregistrement impossible.' });
    }
  };
  if (!p) return <div className="center">Chargement…</div>;
  return (
    <main className="page profile" data-testid="profil">
      <p className="small"><a href="#/">← Retour</a></p>
      <h1>Mon profil</h1>
      <form className="card stack" onSubmit={save}>
        <div className="row">
          <label className="grow">Prénom<input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} maxLength={80} autoComplete="given-name" /></label>
          <label className="grow">Nom<input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} maxLength={80} autoComplete="family-name" /></label>
        </div>
        <label>Adresse e-mail
          <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" placeholder="facultatif" />
        </label>
        <p className="muted small">Avec une adresse e-mail, vous pouvez recevoir vous-même un lien de connexion depuis la page d’accueil (si le serveur
          d’envoi est configuré). Votre adresse n’est visible que des administrateurs.</p>
        {message && <p className={message.kind === 'ok' ? 'muted' : 'error'} role="status">{message.text}</p>}
        <button className="primary">Enregistrer</button>
      </form>
      <div className="card stack small">
        {p.login && <p>Identifiant : <b>{p.login}</b></p>}
        {p.expiresAt && <p>Ce compte expire le <b>{dateTime(p.expiresAt)}</b> : il sera alors supprimé automatiquement.</p>}
        <p><ConnectDevice /> — connecter un autre appareil (téléphone) à ce compte, sans mot de passe.</p>
        <InstallCard compact />
        <button onClick={async () => { await api.post('/api/auth/logout').catch(() => undefined); onLogout(); }}>Se déconnecter de cet appareil</button>
      </div>
    </main>
  );
}
