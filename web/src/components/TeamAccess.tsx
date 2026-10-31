// Membres d'une équipe : liste, ajout de comptes (créés par un administrateur), lien de connexion, retrait.
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../api';
import { dateTime } from '../labels';
import type { TeamMember } from '../types';
import { PhoneLink } from './PhoneLink';

interface Candidate { id: number; displayName: string; globalRole: string; otherTeams: string | null }

export function TeamAccess({ teamId, organizer, onChanged }: {
  teamId: number;
  /** Organisateur : peut désigner des responsables. */
  organizer: boolean;
  onChanged: () => Promise<void>;
}) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [link, setLink] = useState<{ name: string; url: string; expiresAt: string } | null>(null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Candidate[]>([]);
  const base = '/api/teams/' + teamId;

  const load = useCallback(async () => setMembers(await api.get<TeamMember[]>(base + '/members')), [base]);
  useEffect(() => {
    load().catch((e) => setMessage({ kind: 'error', text: e instanceof ApiError ? e.message : 'Chargement impossible.' }));
  }, [load]);
  // Recherche des comptes à ajouter (dès 2 lettres ; la liste vide montre les premiers comptes disponibles).
  const search = useCallback(() => api.get<Candidate[]>(base + '/candidats?q=' + encodeURIComponent(q.trim())).then(setFound, () => setFound([])), [base, q]);
  useEffect(() => { const t = setTimeout(() => void search(), 200); return () => clearTimeout(t); }, [search]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      setMessage({ kind: 'ok', text: ok });
      await load();
      await search();
      await onChanged();
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof ApiError ? e.message : 'Erreur inattendue.' });
    }
  };

  return (
    <div className="team-access stack" data-testid={'acces-equipe-' + teamId}>
      {message && <p className={message.kind === 'ok' ? 'muted small' : 'error small'} role="status">{message.text}</p>}

      {link && (
        <div className="warning small stack">
          <span>Lien de connexion pour <b>{link.name}</b>, valable jusqu’au {dateTime(link.expiresAt)} et une seule fois. Transmettez-le-lui
            (SMS, messagerie) : il ne sera plus affiché.</span>
          <div className="row"><input readOnly value={link.url} aria-label="Lien de connexion du membre" onFocus={(e) => e.target.select()} />
            <button onClick={() => { void navigator.clipboard?.writeText(link.url); }}>Copier</button>
            <button onClick={() => setLink(null)}>Fermer</button></div>
        </div>
      )}

      <section>
        <h4>Membres ({members.length})</h4>
        {members.length === 0 ? <p className="muted small">Aucun membre pour l’instant. Ajoutez des comptes ci-dessous.</p> : (
          <ul className="plain small">
            {members.map((m) => (
              <li key={m.id} className="row">
                <span className="grow">
                  {m.displayName}{m.role === 'responsable' ? ' (responsable)' : ''}
                  <span className="muted">
                    {m.globalRole === 'membre' ? '' : ' · compte d’organisation'}
                    {m.lastSeen ? ' · vu ' + dateTime(m.lastSeen) : ' · jamais connecté'}
                    {m.expiresAt ? ' · expire le ' + dateTime(m.expiresAt) : ''}
                  </span>
                  {m.phone && <> <PhoneLink phone={m.phone} name={m.displayName} /></>}
                </span>
                {organizer && (
                  <button title={m.role === 'responsable' ? 'Redevient simple membre de l’équipe' : 'Peut suivre les SOS de l’équipe ; son téléphone est affiché aux membres'}
                    onClick={() => act(() => api.patch(base + '/members/' + m.id, { role: m.role === 'responsable' ? 'membre' : 'responsable' }),
                      m.role === 'responsable' ? m.displayName + ' n’est plus responsable.' : m.displayName + ' est responsable de l’équipe.')}>
                    {m.role === 'responsable' ? 'Retirer « responsable »' : 'Nommer responsable'}
                  </button>
                )}
                {m.globalRole === 'membre' && (
                  <button title="Lien de connexion à usage unique (nouveau téléphone, accès perdu)" onClick={async () => {
                    try {
                      const r = await api.post<{ url: string; expiresAt: string }>(base + '/members/' + m.id + '/lien');
                      setLink({ name: m.displayName, ...r });
                    } catch (e) {
                      setMessage({ kind: 'error', text: e instanceof ApiError ? e.message : 'Erreur.' });
                    }
                  }}>Lien de connexion</button>
                )}
                <button className="danger" onClick={() => {
                  if (window.confirm('Retirer ' + m.displayName + ' de l’équipe ? Il n’aura plus accès à ses missions.')) {
                    void act(() => api.delete(base + '/members/' + m.id), m.displayName + ' a été retiré·e de l’équipe.');
                  }
                }}>Retirer</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="stack">
        <h4>Ajouter un membre</h4>
        <div className="row small">
          <input className="grow" placeholder="Rechercher un compte (nom, e-mail)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher un compte à ajouter" />
        </div>
        {found.length > 0 ? (
          <ul className="plain small">
            {found.map((c) => (
              <li key={c.id} className="row">
                <span className="grow">{c.displayName}
                  <span className="muted">{c.globalRole === 'membre' ? '' : ' · compte d’organisation'}{c.otherTeams ? ' · déjà dans : ' + c.otherTeams : ''}</span>
                </span>
                <button onClick={() => act(() => api.post(base + '/members', { userId: c.id, role: 'membre' }), c.displayName + ' a rejoint l’équipe.')}>Ajouter</button>
                {organizer && (
                  <button onClick={() => act(() => api.post(base + '/members', { userId: c.id, role: 'responsable' }), c.displayName + ' a rejoint l’équipe comme responsable.')}>
                    Ajouter comme responsable
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : <p className="muted small">{q.trim() ? 'Aucun compte trouvé.' : 'Aucun compte disponible.'}</p>}
        <p className="muted small">Les comptes des membres sont créés par un administrateur (page Comptes), qui leur transmet un lien d’activation.</p>
      </section>
    </div>
  );
}
