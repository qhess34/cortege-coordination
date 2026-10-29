// Administration des comptes (réservée aux administrateurs) : création, rôle global, désactivation, sessions.
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../api';
import { dateTime } from '../labels';

interface Account { id: number; login: string; displayName: string; globalRole: 'admin' | 'organisateur' | 'aucun'; disabledAt: string | null; createdAt: string; email: string | null }
const ROLES: Record<Account['globalRole'], string> = { admin: 'Administrateur', organisateur: 'Organisateur', aucun: 'Sans rôle global' };

export function AdminPage({ meId }: { meId: number }) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [form, setForm] = useState({ login: '', displayName: '', password: '', email: '', globalRole: 'organisateur' as Account['globalRole'] });
  const [link, setLink] = useState<{ login: string; url: string; expiresAt: string } | null>(null);

  const load = () => api.get<Account[]>('/api/admin/users').then(setAccounts, (e) => setToast({ kind: 'error', text: e instanceof ApiError ? e.message : 'Erreur' }));
  useEffect(() => { void load(); }, []);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      setToast({ kind: 'ok', text: ok });
      await load();
      return true;
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof ApiError ? e.message : 'Erreur inattendue.' });
      return false;
    }
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (await act(() => api.post('/api/admin/users', { ...form, email: form.email || null }), 'Compte créé.')) setForm({ login: '', displayName: '', password: '', email: '', globalRole: 'organisateur' });
  };

  return (
    <main className="page" data-testid="administration">
      <h1>Comptes</h1>
      <p className="muted">
        Les comptes sont créés ici uniquement : il n’y a pas d’inscription en ligne. Les participants des équipes n’ont pas
        de compte : ils rejoignent par QR code ou lien d’invitation.
      </p>
      {accounts === null ? <p>Chargement…</p> : (
        <table className="table">
          <thead><tr><th>Identifiant</th><th>Nom</th><th>E-mail</th><th>Rôle global</th><th>État</th><th>Actions</th></tr></thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <td>{a.login}</td>
                <td>{a.displayName}</td>
                <td>
                  <button className="link small" title="Adresse utilisée pour recevoir un lien de connexion" onClick={() => {
                    const v = window.prompt('Adresse e-mail de ' + a.login + ' (vide pour l’effacer) :', a.email ?? '');
                    if (v !== null) void act(() => api.patch('/api/admin/users/' + a.id, { email: v.trim() || null }), 'Adresse enregistrée.');
                  }}>{a.email ?? 'ajouter'}</button>
                </td>
                <td>
                  <select aria-label={'Rôle de ' + a.login} value={a.globalRole} disabled={a.id === meId}
                    onChange={(e) => act(() => api.patch('/api/admin/users/' + a.id, { globalRole: e.target.value }), 'Rôle modifié.')}>
                    {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </td>
                <td>{a.disabledAt ? 'Désactivé le ' + dateTime(a.disabledAt) : 'Actif'}</td>
                <td className="row small">
                  {a.id !== meId && (
                    <button onClick={() => act(() => api.patch('/api/admin/users/' + a.id, { disabled: !a.disabledAt }), a.disabledAt ? 'Compte réactivé.' : 'Compte désactivé, sessions révoquées.')}>
                      {a.disabledAt ? 'Réactiver' : 'Désactiver'}
                    </button>
                  )}
                  {!a.disabledAt && (
                    <button title="Lien de connexion à usage unique (72 h), à transmettre à la personne" onClick={async () => {
                      try {
                        const r = await api.post<{ url: string; expiresAt: string }>('/api/admin/users/' + a.id + '/lien');
                        setLink({ login: a.login, ...r });
                      } catch (e) {
                        setToast({ kind: 'error', text: e instanceof ApiError ? e.message : 'Erreur.' });
                      }
                    }}>Lien de connexion</button>
                  )}
                  <button onClick={() => act(() => api.post('/api/admin/users/' + a.id + '/revoke-sessions'), 'Sessions révoquées.')}>Révoquer les sessions</button>
                  <button onClick={() => {
                    const pw = window.prompt('Nouveau mot de passe pour ' + a.login + ' (12 caractères minimum) :');
                    if (pw) void act(() => api.patch('/api/admin/users/' + a.id, { password: pw }), 'Mot de passe changé, sessions révoquées.');
                  }}>Mot de passe…</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {link && (
        <div className="warning stack" data-testid="lien-admin">
          <span>Lien de connexion pour <b>{link.login}</b>, valable jusqu’au {dateTime(link.expiresAt)} et <b>une seule fois</b>. Transmettez-le
            par un canal sûr (en main propre, messagerie chiffrée) : il donne accès au compte. Il ne sera plus affiché.</span>
          <div className="row"><input readOnly value={link.url} aria-label="Lien de connexion" onFocus={(e) => e.target.select()} />
            <button onClick={() => { void navigator.clipboard?.writeText(link.url); }}>Copier</button>
            <button onClick={() => setLink(null)}>Fermer</button></div>
        </div>
      )}
      <form className="card inline-form" onSubmit={create}>
        <h2>Nouveau compte</h2>
        <label>Identifiant<input value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} required pattern="[a-z0-9._\-]{3,64}" title="3 à 64 caractères : a-z, 0-9, . _ -" /></label>
        <label>Nom affiché<input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} required /></label>
        <label>E-mail (facultatif, pour recevoir un lien de connexion)<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="off" /></label>
        <label>Mot de passe initial<input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={12} autoComplete="new-password" /></label>
        <label>Rôle global
          <select value={form.globalRole} onChange={(e) => setForm({ ...form, globalRole: e.target.value as Account['globalRole'] })}>
            {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <button className="primary">Créer le compte</button>
      </form>
      {toast && <div className={'toast ' + toast.kind} role="status">{toast.text}</div>}
    </main>
  );
}
