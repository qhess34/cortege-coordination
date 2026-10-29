// Membres et invitations d'une équipe : QR code d'équipe, liens individuels, demandes d'admission, membres.
import QRCode from 'qrcode';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../api';
import { dateTime } from '../labels';
import type { Invitation, Team, TeamMember } from '../types';

const STATE: Record<Invitation['state'], string> = {
  valide: 'active', revoquee: 'révoquée', suspendue: 'suspendue', expiree: 'expirée', utilisee: 'utilisée', complete: 'complète', equipe_fermee: 'équipe fermée',
};
const joinUrl = (token: string) => window.location.origin + '/rejoindre/' + token;
const toIso = (local: string) => (local ? new Date(local).toISOString() : null);

interface Props {
  team: Team;
  eventName: string;
  /** Organisateur : peut inviter des responsables et ajouter des comptes. */
  organizer: boolean;
  /** Comptes ayant accès à la manifestation (ajout direct par un organisateur). */
  accounts: { id: number; displayName: string; role: string }[];
  onChanged: () => Promise<void>;
}

export function TeamAccess({ team, eventName, organizer, accounts, onChanged }: Props) {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [admissions, setAdmissions] = useState<{ id: number; displayName: string; createdAt: string }[]>([]);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [freshLink, setFreshLink] = useState<{ url: string; label: string } | null>(null);
  const [account, setAccount] = useState('');
  const base = '/api/teams/' + team.id;

  const load = useCallback(async () => {
    const [i, m, a] = await Promise.all([
      api.get<Invitation[]>(base + '/invitations'),
      api.get<TeamMember[]>(base + '/members'),
      api.get<{ id: number; displayName: string; createdAt: string }[]>(base + '/admissions'),
    ]);
    setInvitations(i);
    setMembers(m);
    setAdmissions(a);
  }, [base]);
  useEffect(() => {
    load().catch((e) => setMessage({ kind: 'error', text: e instanceof ApiError ? e.message : 'Chargement impossible.' }));
  }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      setMessage({ kind: 'ok', text: ok });
      await load();
      await onChanged();
      return true;
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof ApiError ? e.message : 'Erreur inattendue.' });
      return false;
    }
  };

  const qr = invitations.find((i) => i.kind === 'equipe' && !i.revokedAt);
  const links = invitations.filter((i) => i.kind === 'individuelle');
  const inTeam = new Set(members.map((m) => m.id));
  const addable = accounts.filter((a) => !inTeam.has(a.id));

  return (
    <div className="team-access stack" data-testid={'acces-equipe-' + team.id}>
      {message && <p className={message.kind === 'ok' ? 'muted small' : 'error small'} role="status">{message.text}</p>}

      {admissions.length > 0 && (
        <div className="warning">
          <b>Demandes à valider ({admissions.length})</b>
          <ul className="plain">
            {admissions.map((a) => (
              <li key={a.id} className="row small">
                <span className="grow">{a.displayName} <span className="muted">— {dateTime(a.createdAt)}</span></span>
                <button onClick={() => act(() => api.post('/api/admissions/' + a.id + '/decide', { accept: true }), a.displayName + ' a rejoint l’équipe.')}>Accepter</button>
                <button className="danger" onClick={() => act(() => api.post('/api/admissions/' + a.id + '/decide', { accept: false }), 'Demande refusée.')}>Refuser</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <section>
        <h4>QR code de l’équipe</h4>
        {qr ? <QrCard invitation={qr} teamName={team.name} eventName={eventName} act={act} /> : <NewQr teamId={team.id} act={act} />}
      </section>

      <section>
        <h4>Liens individuels</h4>
        <NewLink teamId={team.id} organizer={organizer} onCreated={setFreshLink} act={act} />
        {freshLink && (
          <div className="warning small">
            Lien pour {freshLink.label || 'la personne invitée'} — <b>copiez-le maintenant</b>, il ne sera plus affiché :
            <div className="row"><input readOnly value={freshLink.url} aria-label="Lien d’invitation" onFocus={(e) => e.target.select()} />
              <button onClick={() => { void navigator.clipboard?.writeText(freshLink.url); }}>Copier</button></div>
          </div>
        )}
        {links.length > 0 && (
          <ul className="plain small">
            {links.map((l) => (
              <li key={l.id} className="row">
                <span className="grow">
                  {l.label || (l.participantId ? 'Récupération d’accès' : 'Lien individuel')} · {l.role} · {STATE[l.state]}
                  {l.expiresAt ? <span className="muted"> · jusqu’au {dateTime(l.expiresAt)}</span> : null}
                </span>
                {l.state === 'valide' && <button onClick={() => act(() => api.post('/api/invitations/' + l.id + '/revoke'), 'Lien révoqué.')}>Révoquer</button>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h4>Membres ({members.length})</h4>
        {organizer && addable.length > 0 && (
          <div className="row small">
            <select className="grow" value={account} onChange={(e) => setAccount(e.target.value)} aria-label="Compte à ajouter">
              <option value="">Ajouter un compte de la manifestation…</option>
              {addable.map((a) => <option key={a.id} value={a.id}>{a.displayName}</option>)}
            </select>
            <button disabled={!account} onClick={async () => {
              if (await act(() => api.post(base + '/members', { userId: Number(account) }), 'Compte ajouté à l’équipe.')) setAccount('');
            }}>Ajouter</button>
          </div>
        )}
        {members.length === 0 ? <p className="muted small">Aucun membre pour l’instant.</p> : (
          <ul className="plain small">
            {members.map((m) => (
              <li key={m.id} className="row">
                <span className="grow">
                  {m.displayName}{m.role === 'responsable' ? ' (responsable)' : ''}
                  <span className="muted"> · {m.accountType === 'participant' ? 'invité' : 'compte'}{m.lastSeen ? ' · vu ' + dateTime(m.lastSeen) : ''}</span>
                </span>
                {m.accountType === 'participant' && (
                  <button title="Nouveau lien pour retrouver l’accès sur un autre appareil" onClick={async () => {
                    try {
                      const r = await api.post<Invitation & { token: string }>(base + '/members/' + m.id + '/recovery');
                      setFreshLink({ url: joinUrl(r.token), label: 'la récupération d’accès de ' + m.displayName });
                      await load();
                    } catch (e) {
                      setMessage({ kind: 'error', text: e instanceof ApiError ? e.message : 'Erreur.' });
                    }
                  }}>Lien de récupération</button>
                )}
                <button className="danger" onClick={() => {
                  if (window.confirm('Retirer ' + m.displayName + ' de l’équipe ?' + (m.accountType === 'participant' ? ' Son accès sera coupé immédiatement.' : ''))) {
                    void act(() => api.delete(base + '/members/' + m.id), m.displayName + ' a été retiré·e.');
                  }
                }}>Retirer</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function NewQr({ teamId, act }: { teamId: number; act: (fn: () => Promise<unknown>, ok: string) => Promise<boolean> }) {
  const [admission, setAdmission] = useState<'immediate' | 'validation'>('validation');
  const [maxUses, setMaxUses] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void act(() => api.post('/api/teams/' + teamId + '/invitations', {
      kind: 'equipe', admission, maxUses: maxUses ? Number(maxUses) : null, expiresAt: toIso(expiresAt),
    }), 'QR code créé.');
  };
  return (
    <form className="stack small" onSubmit={submit}>
      <label>Admission
        <select value={admission} onChange={(e) => setAdmission(e.target.value as 'immediate' | 'validation')}>
          <option value="validation">Après validation par un responsable</option>
          <option value="immediate">Immédiate</option>
        </select>
      </label>
      <div className="row">
        <label>Nombre maximal de personnes<input type="number" min={1} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder="illimité" /></label>
        <label>Valable jusqu’au<input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} /></label>
      </div>
      <button className="primary">Créer le QR code</button>
    </form>
  );
}

function QrCard({ invitation: i, teamName, eventName, act }: { invitation: Invitation; teamName: string; eventName: string; act: (fn: () => Promise<unknown>, ok: string) => Promise<boolean> }) {
  const [img, setImg] = useState<string | null>(null);
  const url = joinUrl(i.token!);
  useEffect(() => { QRCode.toDataURL(url, { margin: 1, width: 480, errorCorrectionLevel: 'M' }).then(setImg, () => setImg(null)); }, [url]);

  const print = () => {
    const w = window.open('', '_blank', 'noopener=no');
    if (!w || !img) return;
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    w.document.write('<!doctype html><meta charset="utf-8"><title>QR ' + esc(teamName) + '</title>' +
      '<body style="font-family:system-ui;text-align:center;padding:2rem"><h1>' + esc(teamName) + '</h1><p>' + esc(eventName) +
      '</p><img src="' + img + '" style="width:12cm;height:12cm"><p>Scannez pour rejoindre l’équipe</p></body>');
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <div className="qr-card">
      {img && <img src={img} alt={'QR code pour rejoindre ' + teamName} width={180} height={180} data-testid="qr-code" />}
      <div className="stack small">
        <span>
          <b>{STATE[i.state]}</b> · admission {i.admission === 'immediate' ? 'immédiate' : 'après validation'} · {i.uses}{i.maxUses ? '/' + i.maxUses : ''} utilisation(s)
          {i.expiresAt ? ' · jusqu’au ' + dateTime(i.expiresAt) : ''}
        </span>
        <input readOnly value={url} aria-label="Lien du QR code" onFocus={(e) => e.target.select()} />
        <div className="row">
          <button onClick={print} disabled={!img}>Imprimer</button>
          {i.suspended
            ? <button onClick={() => act(() => api.post('/api/invitations/' + i.id + '/resume'), 'Admissions reprises.')}>Reprendre les admissions</button>
            : <button onClick={() => act(() => api.post('/api/invitations/' + i.id + '/suspend'), 'Admissions suspendues.')}>Suspendre</button>}
          <button className="danger" onClick={() => {
            if (window.confirm('Régénérer le QR code ? L’ancien (affiches déjà imprimées) ne fonctionnera plus.')) {
              void act(async () => {
                await api.post('/api/invitations/' + i.id + '/revoke');
                await api.post('/api/teams/' + i.teamId + '/invitations', { kind: 'equipe', admission: i.admission, maxUses: i.maxUses, expiresAt: i.expiresAt });
              }, 'Nouveau QR code créé ; l’ancien est désactivé.');
            }
          }}>Régénérer</button>
          <button onClick={() => act(() => api.post('/api/invitations/' + i.id + '/revoke'), 'QR code désactivé.')}>Désactiver</button>
        </div>
      </div>
    </div>
  );
}

function NewLink({ teamId, organizer, onCreated, act }: {
  teamId: number; organizer: boolean; onCreated: (l: { url: string; label: string }) => void;
  act: (fn: () => Promise<unknown>, ok: string) => Promise<boolean>;
}) {
  const [label, setLabel] = useState('');
  const [role, setRole] = useState<'membre' | 'responsable'>('membre');
  const [hours, setHours] = useState('72');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await act(async () => {
      const r = await api.post<Invitation & { token: string }>('/api/teams/' + teamId + '/invitations', {
        kind: 'individuelle', admission: 'immediate', role, label, expiresAt: new Date(Date.now() + Number(hours) * 3600_000).toISOString(),
      });
      onCreated({ url: joinUrl(r.token), label });
    }, 'Lien créé.');
    if (ok) setLabel('');
  };
  return (
    <form className="row small" onSubmit={submit}>
      <input placeholder="Pour qui ? (facultatif)" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} />
      {organizer && (
        <select value={role} onChange={(e) => setRole(e.target.value as 'membre' | 'responsable')} aria-label="Rôle">
          <option value="membre">Membre</option>
          <option value="responsable">Responsable</option>
        </select>
      )}
      <select value={hours} onChange={(e) => setHours(e.target.value)} aria-label="Validité">
        <option value="24">24 h</option><option value="72">3 jours</option><option value="168">7 jours</option><option value="720">30 jours</option>
      </select>
      <button>Créer un lien</button>
    </form>
  );
}
