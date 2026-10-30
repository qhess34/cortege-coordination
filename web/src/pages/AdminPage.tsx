// Administration des comptes (réservée aux administrateurs) : membres d'équipe et comptes d'organisation, expiration,
// liens de connexion, désactivation, suppression.
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../api';
import { dateTime } from '../labels';
import { formatPhone } from '../components/PhoneLink';

type Role = 'admin' | 'organisateur' | 'membre' | 'aucun';
interface Account {
  id: number; login: string | null; displayName: string; firstName: string; lastName: string; globalRole: Role;
  disabledAt: string | null; createdAt: string; email: string | null; phone: string | null; expiresAt: string | null;
}
const ROLES: Record<Role, string> = { membre: 'Membre d’équipe', organisateur: 'Organisateur', admin: 'Administrateur', aucun: 'Compte sans rôle' };
const toLocal = (s: string | null) => (s ? new Date(new Date(s).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
const fromLocal = (s: string) => (s ? new Date(s).toISOString() : null);
const EMPTY = { globalRole: 'membre' as Role, firstName: '', lastName: '', email: '', phone: '', login: '', password: '', expiresAt: '' };

export function AdminPage({ meId }: { meId: number }) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [link, setLink] = useState<{ name: string; url: string; expiresAt: string; activation: boolean } | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [filter, setFilter] = useState('');

  const load = () => api.get<Account[]>('/api/admin/users').then(setAccounts, (e) => setToast({ kind: 'error', text: e instanceof ApiError ? e.message : 'Erreur' }));
  useEffect(() => { void load(); }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t); }, [toast]);

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

  const member = form.globalRole === 'membre';
  const create = async (e: FormEvent) => {
    e.preventDefault();
    let created: (Account & { activation: { url: string; expiresAt: string } | null }) | null = null;
    const ok = await act(async () => {
      created = await api.post('/api/admin/users', {
        globalRole: form.globalRole, firstName: form.firstName, lastName: form.lastName, email: form.email.trim() || null, phone: form.phone.trim(),
        login: member ? null : form.login, password: member ? null : form.password, expiresAt: fromLocal(form.expiresAt),
      });
    }, 'Compte créé.');
    if (ok && created) {
      const c = created as Account & { activation: { url: string; expiresAt: string } | null };
      if (c.activation) setLink({ name: c.displayName, ...c.activation, activation: true });
      setForm({ ...EMPTY, globalRole: form.globalRole, expiresAt: form.expiresAt });
    }
  };

  const shown = (accounts ?? []).filter((a) => !filter || (a.displayName + ' ' + (a.login ?? '') + ' ' + (a.email ?? '') + ' ' + (a.phone ?? '')).toLowerCase().includes(filter.toLowerCase()));

  return (
    <main className="page" data-testid="administration">
      <h1>Comptes</h1>
      <p className="muted">
        Tous les comptes sont créés ici : il n’y a pas d’inscription en ligne. Un <b>membre d’équipe</b> n’a ni identifiant ni mot
        de passe : transmettez-lui son <b>lien d’activation</b>, puis l’organisation l’ajoute à une équipe. Un compte avec une
        <b> date d’expiration</b> est supprimé automatiquement à cette date.
      </p>

      {link && (
        <div className="warning stack" data-testid="lien-admin">
          <span>{link.activation ? 'Lien d’activation' : 'Lien de connexion'} pour <b>{link.name}</b>, valable jusqu’au {dateTime(link.expiresAt)} et
            <b> une seule fois</b>. Transmettez-le par un canal sûr (SMS, messagerie, en main propre) : il donne accès au compte. Il ne sera plus affiché.</span>
          <div className="row"><input readOnly value={link.url} aria-label="Lien de connexion" onFocus={(e) => e.target.select()} />
            <button onClick={() => { void navigator.clipboard?.writeText(link.url); }}>Copier</button>
            <button onClick={() => setLink(null)}>Fermer</button></div>
        </div>
      )}

      <form className="card stack" onSubmit={create} data-testid="nouveau-compte">
        <h2>Nouveau compte</h2>
        <div className="kind-choice" role="radiogroup" aria-label="Type de compte">
          {(['membre', 'organisateur', 'admin'] as Role[]).map((r) => (
            <label key={r} className={'check' + (form.globalRole === r ? ' selected' : '')}>
              <input type="radio" name="role" checked={form.globalRole === r} onChange={() => setForm({ ...form, globalRole: r })} /> {ROLES[r]}
            </label>
          ))}
        </div>
        <div className="row">
          <label className="grow">Prénom<input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} maxLength={80} /></label>
          <label className="grow">Nom<input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} maxLength={80} /></label>
        </div>
        <label>E-mail (facultatif : pour recevoir soi-même un lien de connexion)
          <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="off" />
        </label>
        <label>Téléphone (facultatif : pour joindre la personne le jour J)
          <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} autoComplete="off" maxLength={30} />
        </label>
        {!member && (
          <div className="row">
            <label className="grow">Identifiant<input value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} required pattern="[a-z0-9._\-]{3,64}" title="3 à 64 caractères : a-z, 0-9, . _ -" autoComplete="off" /></label>
            <label className="grow">Mot de passe initial<input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={12} autoComplete="new-password" /></label>
          </div>
        )}
        <label>Expiration (facultatif) : suppression automatique du compte à cette date
          <input type="datetime-local" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
        </label>
        <button className="primary">{member ? 'Créer le compte et obtenir le lien d’activation' : 'Créer le compte'}</button>
      </form>

      <div className="row">
        <h2 className="grow">Comptes ({accounts?.length ?? '…'})</h2>
        <input placeholder="Filtrer" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrer les comptes" />
      </div>
      {accounts === null ? <p>Chargement…</p> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Nom</th><th>Type</th><th>Connexion</th><th>Expiration</th><th>État</th><th>Actions</th></tr></thead>
            <tbody>
              {shown.map((a) => (
                <tr key={a.id} data-testid={'compte-' + a.id}>
                  <td>{a.displayName}{a.email || a.phone ? <div className="muted small">{[a.email, a.phone && formatPhone(a.phone)].filter(Boolean).join(' · ')}</div> : null}</td>
                  <td>{ROLES[a.globalRole]}</td>
                  <td className="small">{a.login ? 'identifiant « ' + a.login + ' »' : 'par lien'}</td>
                  <td className="small">{a.expiresAt ? dateTime(a.expiresAt) : '—'}</td>
                  <td className="small">{a.disabledAt ? 'Désactivé' : 'Actif'}</td>
                  <td className="row small">
                    {!a.disabledAt && (
                      <button title="Lien de connexion à usage unique (72 h), à transmettre à la personne" onClick={async () => {
                        try {
                          const r = await api.post<{ url: string; expiresAt: string }>('/api/admin/users/' + a.id + '/lien');
                          setLink({ name: a.displayName, ...r, activation: false });
                        } catch (e) {
                          setToast({ kind: 'error', text: e instanceof ApiError ? e.message : 'Erreur.' });
                        }
                      }}>Lien de connexion</button>
                    )}
                    <button onClick={() => setEditing(editing === a.id ? null : a.id)} aria-expanded={editing === a.id}>Modifier</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing !== null && accounts?.find((a) => a.id === editing) && (
        <EditAccount account={accounts.find((a) => a.id === editing)!} self={editing === meId} act={act} onClose={() => setEditing(null)} />
      )}
      {toast && <div className={'toast ' + toast.kind} role="status">{toast.text}</div>}
    </main>
  );
}

function EditAccount({ account: a, self, act, onClose }: {
  account: Account; self: boolean; act: (fn: () => Promise<unknown>, ok: string) => Promise<boolean>; onClose: () => void;
}) {
  const [f, setF] = useState({ firstName: a.firstName, lastName: a.lastName, email: a.email ?? '', phone: a.phone ?? '', globalRole: a.globalRole, expiresAt: toLocal(a.expiresAt) });
  const url = '/api/admin/users/' + a.id;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await act(() => api.patch(url, {
      firstName: f.firstName, lastName: f.lastName, email: f.email.trim() || null, phone: f.phone.trim(),
      ...(self ? {} : { globalRole: f.globalRole, expiresAt: fromLocal(f.expiresAt) }),
    }), 'Compte enregistré.');
    if (ok) onClose();
  };
  return (
    <form className="card stack" onSubmit={save} data-testid="modifier-compte">
      <h2>{a.displayName}</h2>
      <div className="row">
        <label className="grow">Prénom<input value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} maxLength={80} /></label>
        <label className="grow">Nom<input value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} maxLength={80} /></label>
      </div>
      <label>E-mail<input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
      <label>Téléphone<input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} maxLength={30} /></label>
      {!self && (
        <>
          <label>Type de compte
            <select value={f.globalRole} onChange={(e) => setF({ ...f, globalRole: e.target.value as Role })}>
              {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k} disabled={k !== 'membre' && !a.login}>{v}</option>)}
            </select>
          </label>
          <label>Expiration (suppression automatique)
            <input type="datetime-local" value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} />
          </label>
        </>
      )}
      <div className="row">
        <button className="primary">Enregistrer</button>
        <button type="button" onClick={onClose}>Annuler</button>
        <span className="grow" />
        {a.login && <button type="button" onClick={() => {
          const pw = window.prompt('Nouveau mot de passe pour ' + a.displayName + ' (12 caractères minimum) :');
          if (pw) void act(() => api.patch(url, { password: pw }), 'Mot de passe changé, sessions révoquées.');
        }}>Mot de passe…</button>}
        <button type="button" onClick={() => act(() => api.post(url + '/revoke-sessions'), 'Sessions révoquées.')}>Déconnecter partout</button>
        {!self && (
          <button type="button" onClick={() => act(() => api.patch(url, { disabled: !a.disabledAt }), a.disabledAt ? 'Compte réactivé.' : 'Compte désactivé, sessions révoquées.')}>
            {a.disabledAt ? 'Réactiver' : 'Désactiver'}
          </button>
        )}
        {!self && (
          <button type="button" className="danger" onClick={async () => {
            if (window.confirm('Supprimer définitivement le compte de ' + a.displayName + ' ?')) {
              if (await act(() => api.delete(url), 'Compte supprimé.')) onClose();
            }
          }}>Supprimer</button>
        )}
      </div>
    </form>
  );
}
