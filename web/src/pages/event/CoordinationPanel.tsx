// Tableau de bord partagé du jour J : progression déclarée, incidents, état des équipes, messages.
import { Fragment, useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../api';
import { INCIDENT_CATEGORY, INCIDENT_STATUS, type FieldIncident, type Progress } from '../../components/FieldView';
import { MISSION_STATUS, TEAM_KIND, TEAM_KIND_SHORT, km } from '../../labels';
import type { Position } from '../../types';
import { ago } from '../../useLive';
import type { MemberPosition } from '../../components/MapView';
import type { PanelProps } from '../EventPage';

export interface Tableau {
  teams: {
    id: number; name: string; color: string; disabled: boolean; members: number; active: number; kind: string; sharing: number;
    missions: {
      id: number; version: number; order: number; status: string; statusChangedAt: string | null; changedBy: string | null; pointName: string;
      distance: number | null; position: Position; passedByTail: boolean;
    }[];
  }[];
  incidents: (FieldIncident & { teamName: string | null; position: Position | null })[];
  progress: Progress | null;
  tail: Progress | null;
  progressHistory: (Progress & { part: 'tete' | 'queue' })[];
  canDeclare: { tete: boolean; queue: boolean };
  live: number;
}
interface OrgMessage { id: number; teamId: number | null; teamName: string | null; body: string; urgent: boolean; createdAt: string; authorName: string; fromOrganisation: boolean; reads: number; recipients: number }

/** Ordre d'affichage des statuts (du plus urgent au plus calme). */
const STATUS_ORDER = ['incident', 'releve_necessaire', 'en_deplacement', 'affectee', 'a_preparer', 'en_position', 'terminee'];

export function CoordinationPanel({ data, canEdit, liveTick, members }: PanelProps & { liveTick: number; members: MemberPosition[] | null }) {
  // Partage de position : compté sur les positions reçues en direct (plus à jour que le tableau).
  const sharingOf = (teamId: number, fallback: number) => (members ? members.filter((m) => m.teamId === teamId).length : fallback);
  const eventId = data.event.id;
  const [t, setT] = useState<Tableau | null>(null);
  const [messages, setMessages] = useState<OrgMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [, tick] = useState(0);

  const load = useCallback(async () => {
    try {
      const [tab, msgs] = await Promise.all([
        api.get<Tableau>('/api/events/' + eventId + '/tableau'),
        api.get<OrgMessage[]>('/api/events/' + eventId + '/messages'),
      ]);
      setT(tab);
      setMessages(msgs);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Chargement impossible.');
    }
  }, [eventId]);
  // Recharge à chaque signal du direct (géré par la page) et à l'ouverture.
  useEffect(() => { void load(); }, [load, liveTick]);
  useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(i); }, []);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      setMessage({ kind: 'ok', text: ok });
      await load();
      return true;
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof ApiError ? e.message : 'Action impossible.' });
      await load();
      return false;
    }
  };

  if (!t) return <p className="muted">{error ?? 'Chargement…'}</p>;
  const all = t.teams.flatMap((x) => x.missions);
  const count = (s: string) => all.filter((m) => m.status === s).length;
  // Points dépassés par la queue du cortège mais encore tenus.
  const toRelease = all.filter((m) => m.passedByTail && m.status !== 'terminee').length;

  return (
    <div className="stack" data-testid="coordination">
      {message && <p className={message.kind === 'ok' ? 'muted small' : 'error small'} role="status">{message.text}</p>}

      <div className="grid-stats">
        <div className="stat"><b>{count('en_position')}/{all.length}</b><span>En position</span></div>
        <div className="stat"><b>{count('en_deplacement')}</b><span>En route</span></div>
        <div className="stat"><b className={t.incidents.length ? 'alert' : ''}>{t.incidents.length}</b><span>Incidents ouverts</span></div>
        <div className="stat"><b>{t.progress ? km(t.progress.distance) : '—'}</b><span>Tête du cortège</span></div>
        <div className="stat"><b>{t.tail ? km(t.tail.distance) : '—'}</b><span>Queue du cortège</span></div>
        <div className="stat"><b className={toRelease ? 'alert' : ''}>{toRelease}</b><span>Points à lever</span></div>
      </div>

      <ProgressCard eventId={eventId} t={t} act={act} />

      <div className="card">
        <h3>Incidents ouverts ({t.incidents.length})</h3>
        {t.incidents.length === 0 ? <p className="muted">Aucun incident en cours.</p> : (
          <ul className="plain">
            {t.incidents.map((i) => (
              <li key={i.id} className={'incident p-' + i.priority + ' st-' + i.status}>
                <p>
                  <b>{INCIDENT_CATEGORY[i.category] ?? i.category}</b>{i.priority === 'haute' ? ' · PRIORITAIRE' : ''} — {INCIDENT_STATUS[i.status]}
                  {i.handledByName && i.status === 'pris_en_charge' ? ' par ' + i.handledByName : ''}
                </p>
                <p className="small">{i.teamName ?? '—'}{i.pointName ? ' · ' + i.pointName : ''} · {i.reporterName ?? ''} · {ago(i.createdAt)}</p>
                {i.description && <p className="pre small">{i.description}</p>}
                <div className="row small">
                  {i.position && <a href={'https://www.openstreetmap.org/?mlat=' + i.position[1] + '&mlon=' + i.position[0] + '#map=18/' + i.position[1] + '/' + i.position[0]} target="_blank" rel="noreferrer">Position signalée</a>}
                  {canEdit && i.status === 'ouvert' && <button onClick={() => act(() => api.patch('/api/incidents/' + i.id, { status: 'pris_en_charge', version: i.version }), 'Incident pris en charge.')}>Je m’en occupe</button>}
                  {canEdit && <button onClick={() => act(() => api.patch('/api/incidents/' + i.id, { status: 'resolu', version: i.version }), 'Incident résolu.')}>Résolu</button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h3>Équipes</h3>
        {t.teams.filter((x) => !x.disabled).map((team) => (
          <div key={team.id} className="coord-team" data-testid={'coord-equipe-' + team.id}>
            <p className="row">
              <span className="dot" style={{ background: team.color }} />
              <b className="grow">{team.name}{team.kind !== 'points' && <span className="badge">{TEAM_KIND_SHORT[team.kind]}</span>}</b>
              <span className="muted small" title="Membres ayant utilisé l’application ces 5 dernières minutes">{team.active}/{team.members} actif(s)</span>
              {sharingOf(team.id, team.sharing) > 0 && <span className="muted small" title="Membres partageant leur position (visible sur la carte)">📡 {sharingOf(team.id, team.sharing)}</span>}
            </p>
            {team.missions.length === 0 ? <p className="muted small">{team.kind === 'points' ? 'Aucune mission.' : TEAM_KIND[team.kind] + ' (sans point fixe).'}</p> : (
              <ul className="plain small">
                {[...team.missions].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.order - b.order).map((m) => (
                  <li key={m.id} className="row">
                    <span className={'status-badge s-' + m.status}>{MISSION_STATUS[m.status] ?? m.status}</span>
                    <span className="grow">{m.pointName}{m.passedByTail && m.status !== 'terminee' && <span className="badge warn" title="La queue du cortège a dépassé ce point">à lever</span>}</span>
                    <span className="muted">{m.statusChangedAt ? ago(m.statusChangedAt) + (m.changedBy ? ' · ' + m.changedBy : '') : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        <p className="muted small">L’ordre des missions et les affectations se règlent dans l’onglet Équipes.</p>
      </div>

      <MessagesCard eventId={eventId} teams={t.teams} messages={messages} canEdit={canEdit} act={act} />
      <p className="muted small">{t.live} écran(s) connecté(s) en direct à cette manifestation.</p>
    </div>
  );
}

function ProgressCard({ eventId, t, act }: { eventId: number; t: Tableau; act: (fn: () => Promise<unknown>, ok: string) => Promise<boolean> }) {
  const [part, setPart] = useState<'tete' | 'queue'>('tete');
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await act(() => api.post('/api/events/' + eventId + '/progression', { part, distance: Math.round(Number(value.replace(',', '.')) * 1000), note }),
      (part === 'tete' ? 'Tête' : 'Queue') + ' du cortège déclarée.');
    if (ok) { setValue(''); setNote(''); }
  };
  const line = (label: string, p: Progress | null) => (
    p ? <p>{label} au <b>{km(p.distance)}</b> — {ago(p.at)}{p.authorName ? ' par ' + p.authorName : ''}{p.note ? ' · ' + p.note : ''}</p>
      : <p className="muted">{label} : non déclarée.</p>
  );
  return (
    <div className="card">
      <h3>Progression du cortège</h3>
      <p className="muted small">Déclarée par l’organisation, l’équipe d’ouverture (tête) ou de fermeture (queue) — ce n’est pas un suivi GPS.</p>
      {line('Tête', t.progress)}
      {line('Queue', t.tail)}
      {(t.canDeclare.tete || t.canDeclare.queue) && (
        <form className="row" onSubmit={submit}>
          <select value={part} onChange={(e) => setPart(e.target.value as 'tete' | 'queue')} aria-label="Partie du cortège">
            {t.canDeclare.tete && <option value="tete">Tête</option>}
            {t.canDeclare.queue && <option value="queue">Queue</option>}
          </select>
          <input inputMode="decimal" placeholder="km (ex. 2,4)" value={value} onChange={(e) => setValue(e.target.value)} required pattern="\d+([.,]\d+)?" aria-label="Distance parcourue en km" />
          <input className="grow" placeholder="Repère (facultatif)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          <button>Déclarer</button>
        </form>
      )}
      {t.progressHistory.length > 1 && (
        <details><summary className="small">Historique</summary>
          <dl className="kv small">{t.progressHistory.map((p, i) => <Fragment key={i}><dt>{ago(p.at)}</dt><dd>{p.part === 'queue' ? 'Queue' : 'Tête'} · {km(p.distance)}{p.note ? ' · ' + p.note : ''}</dd></Fragment>)}</dl>
        </details>
      )}
    </div>
  );
}

function MessagesCard({ eventId, teams, messages, canEdit, act }: {
  eventId: number; teams: Tableau['teams']; messages: OrgMessage[]; canEdit: boolean; act: (fn: () => Promise<unknown>, ok: string) => Promise<boolean>;
}) {
  const [body, setBody] = useState('');
  const [teamId, setTeamId] = useState('');
  const [urgent, setUrgent] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await act(() => api.post('/api/events/' + eventId + '/messages', { body, teamId: teamId ? Number(teamId) : null, urgent }), 'Message envoyé.');
    if (ok) { setBody(''); setUrgent(false); }
  };
  return (
    <div className="card" data-testid="messages-orga">
      <h3>Messages</h3>
      {canEdit && (
        <form className="stack" onSubmit={submit}>
          <textarea rows={2} placeholder="Message" value={body} onChange={(e) => setBody(e.target.value)} required maxLength={2000} aria-label="Message à envoyer" />
          <div className="row">
            <select value={teamId} onChange={(e) => setTeamId(e.target.value)} aria-label="Destinataires">
              <option value="">À toutes les équipes</option>
              {teams.filter((x) => !x.disabled).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <label className="check"><input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> Urgent</label>
            <button className="primary">Envoyer</button>
          </div>
        </form>
      )}
      <ul className="plain messages-list">
        {messages.slice(0, 50).map((m) => (
          <li key={m.id} className={'message' + (m.urgent ? ' urgent' : '') + (m.fromOrganisation ? ' orga' : '')}>
            <p className="small muted">
              <b>{m.authorName}</b> → {m.teamName ?? 'toutes les équipes'} · {ago(m.createdAt)}{m.urgent ? ' · URGENT' : ''}
              {m.fromOrganisation && <> · lu {m.reads}/{m.recipients}</>}
            </p>
            <p className="pre">{m.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
