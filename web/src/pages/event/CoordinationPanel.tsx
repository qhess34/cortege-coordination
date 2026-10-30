// Tableau de bord partagé du jour J : progression du cortège, incidents, état des équipes, messages.
import { Fragment, useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../api';
import { INCIDENT_CATEGORY, INCIDENT_STATUS, type FieldIncident, type Progress } from '../../components/FieldView';
import { MISSION_STATUS, TEAM_KIND, TEAM_KIND_SHORT, km } from '../../labels';
import type { Position } from '../../types';
import { ago } from '../../useLive';
import type { MemberPosition } from '../../components/MapView';
import { PhoneLink, formatPhone } from '../../components/PhoneLink';

export interface Tableau {
  teams: {
    id: number; name: string; color: string; disabled: boolean; members: number; active: number; kind: string; sharing: number;
    contacts: { id: number; displayName: string; phone: string; role: string }[];
    /** Responsables de l'équipe ; numéro visible de l'organisation seulement. */
    leaders: { id: number; displayName: string; phone: string | null }[];
    missions: {
      id: number; version: number; order: number; status: string; statusChangedAt: string | null; changedBy: string | null; pointId: number; pointName: string;
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

/** Sections du tableau de bord : toutes sur ordinateur, une par onglet sur la vue mobile. */
export type CoordSection = 'synthese' | 'incidents' | 'equipes' | 'messages';
const ALL: CoordSection[] = ['synthese', 'incidents', 'equipes', 'messages'];

export function CoordinationPanel({ event, canEdit, liveTick, members, sections = ALL, onCounts }: {
  event: { id: number; locationSharing: boolean }; canEdit: boolean;
  liveTick: number; members: MemberPosition[] | null; sections?: CoordSection[];
  /** Compteurs pour les badges d'onglets de la vue mobile. */
  onCounts?: (c: { incidents: number; messages: number }) => void;
}) {
  const show = (s: CoordSection) => sections.includes(s);
  // Partage de position : compté sur les positions reçues en direct (plus à jour que le tableau).
  const sharingOf = (teamId: number, fallback: number) => (members ? members.filter((m) => m.teamId === teamId).length : fallback);
  const eventId = event.id;
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
      onCounts?.({ incidents: tab.incidents.length, messages: msgs.filter((m) => !m.fromOrganisation && Date.now() - new Date(m.createdAt).getTime() < 3600_000).length });
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Chargement impossible.');
    }
  }, [eventId]); // eslint-disable-line react-hooks/exhaustive-deps
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

      {show('synthese') && <>
      <div className="grid-stats">
        <div className="stat"><b>{count('en_position')}/{all.length}</b><span>En position</span></div>
        <div className="stat"><b>{count('en_deplacement')}</b><span>En route</span></div>
        <div className="stat"><b className={t.incidents.length ? 'alert' : ''}>{t.incidents.length}</b><span>Incidents ouverts</span></div>
        <div className="stat"><b>{t.progress ? km(t.progress.distance) : '—'}</b><span>Tête du cortège</span></div>
        <div className="stat"><b>{t.tail ? km(t.tail.distance) : '—'}</b><span>Queue du cortège</span></div>
        <div className="stat"><b className={toRelease ? 'alert' : ''}>{toRelease}</b><span>Points à lever</span></div>
      </div>

      <NextPoints t={t} />
      <TeamsStatus eventId={eventId} t={t} canEdit={canEdit} act={act} />
      <ProgressCard eventId={eventId} t={t} act={act} />
      </>}

      {show('incidents') && <div className="card">
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
      </div>}

      {show('equipes') && <div className="card">
        <h3>Équipes</h3>
        {t.teams.filter((x) => !x.disabled).map((team) => (
          <div key={team.id} className="coord-team" data-testid={'coord-equipe-' + team.id}>
            <p className="row">
              <span className="dot" style={{ background: team.color }} />
              <b className="grow">{team.name}{team.kind !== 'points' && <span className="badge">{TEAM_KIND_SHORT[team.kind]}</span>}</b>
              <span className="muted small" title="Membres ayant utilisé l’application ces 5 dernières minutes">{team.active}/{team.members} actif(s)</span>
              {sharingOf(team.id, team.sharing) > 0 && <span className="muted small" title="Membres partageant leur position (visible sur la carte)">📡 {sharingOf(team.id, team.sharing)}</span>}
            </p>
            {team.contacts.length > 0 && (
              <details className="small"><summary>📞 Joindre l’équipe ({team.contacts.length})</summary>
                <ul className="plain">
                  {team.contacts.map((c) => <li key={c.id}>{c.displayName}{c.role === 'responsable' ? ' (responsable)' : ''} <PhoneLink phone={c.phone} name={c.displayName} /></li>)}
                </ul>
              </details>
            )}
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
        <p className="muted small">L’ordre des missions et les affectations se règlent dans l’onglet Équipes (planification).</p>
      </div>}

      {show('equipes') && canEdit && event.locationSharing && <TrackersCard eventId={eventId} liveTick={liveTick} members={members} />}

      {show('messages') && <MessagesCard eventId={eventId} teams={t.teams} messages={messages} canEdit={canEdit} act={act} />}
      {show('synthese') && <p className="muted small">{t.live} écran(s) connecté(s) en direct à cette manifestation.</p>}
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
      <p className="muted small">Calculée automatiquement à partir des positions partagées des équipes d’ouverture (tête) et de fermeture (queue), ou déclarée à la main. Indicative : à confirmer sur le terrain.</p>
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

interface Tracker { id: string; displayName: string; teamName: string; color: string; lastSeenAt: string | null; battery: number | null; expiresAt: string }

/** Téléphones suivis par OwnTracks (écran éteint) : dernier envoi, batterie, révocation. */
function TrackersCard({ eventId, liveTick, members }: { eventId: number; liveTick: number; members: MemberPosition[] | null }) {
  const [list, setList] = useState<Tracker[]>([]);
  const load = useCallback(() => { api.get<Tracker[]>('/api/events/' + eventId + '/trackers').then(setList, () => undefined); }, [eventId]);
  useEffect(load, [load, liveTick, members]);
  return (
    <div className="card" data-testid="owntracks-orga">
      <h3>Suivi OwnTracks ({list.length})</h3>
      {list.length === 0 ? <p className="muted small">Aucun membre n’a configuré OwnTracks (suivi écran éteint).</p> : (
        <ul className="plain small">
          {list.map((k) => (
            <li key={k.id} className="row">
              <span className="dot" style={{ background: k.color }} />
              <span className="grow">{k.displayName} <span className="muted">({k.teamName})</span></span>
              <span className={k.battery !== null && k.battery < 20 ? 'error' : 'muted'}>{k.battery !== null ? '🔋 ' + k.battery + ' %' : ''}</span>
              <span className="muted">{k.lastSeenAt ? ago(k.lastSeenAt) : 'jamais'}</span>
              <button onClick={async () => {
                if (!window.confirm('Révoquer le suivi OwnTracks de ' + k.displayName + ' ?')) return;
                await api.post('/api/trackers/' + k.id + '/revoke').catch(() => undefined);
                load();
              }}>Révoquer</button>
            </li>
          ))}
        </ul>
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

/** État d'un point vu de la coordination : le plus grave l'emporte (aide, incident), puis la présence d'une équipe. */
type PointState = 'aide' | 'incident' | 'releve' | 'en_position' | 'en_route' | 'personne' | 'termine';
const POINT_STATE: Record<PointState, { label: string; css: string }> = {
  aide: { label: '🆘 Besoin d’aide', css: 's-incident' },
  incident: { label: '⚠ Incident', css: 's-incident' },
  releve: { label: 'Relève nécessaire', css: 's-releve_necessaire' },
  en_position: { label: '✓ Équipe en position', css: 's-en_position' },
  en_route: { label: 'Personne · équipe en route', css: 's-en_deplacement' },
  personne: { label: 'Personne', css: 's-a_preparer' },
  termine: { label: 'Levé', css: 's-terminee' },
};

/** Prochains points devant la tête du cortège (ou depuis le départ si la tête n'est pas connue), avec leur état. */
function NextPoints({ t }: { t: Tableau }) {
  const head = t.progress?.distance ?? 0;
  const open = t.incidents.filter((i) => i.status !== 'resolu');
  const byPoint = new Map<number, { id: number; name: string; distance: number; missions: (Tableau['teams'][number]['missions'][number] & { team: Tableau['teams'][number] })[] }>();
  for (const team of t.teams.filter((x) => !x.disabled)) {
    for (const m of team.missions) {
      if (m.distance === null || m.distance < head) continue;
      const p = byPoint.get(m.pointId) ?? { id: m.pointId, name: m.pointName, distance: m.distance, missions: [] };
      p.missions.push({ ...m, team });
      byPoint.set(m.pointId, p);
    }
  }
  const next = [...byPoint.values()].sort((a, b) => a.distance - b.distance).slice(0, 6);
  const state = (p: (typeof next)[number]): PointState => {
    const ids = new Set(p.missions.map((m) => m.id));
    const inc = open.filter((i) => i.missionId !== null && ids.has(i.missionId));
    const has = (s: string) => p.missions.some((m) => m.status === s);
    if (inc.some((i) => i.category === 'aide')) return 'aide';
    if (inc.length || has('incident')) return 'incident';
    if (has('releve_necessaire')) return 'releve';
    if (has('en_position')) return 'en_position';
    if (p.missions.every((m) => m.status === 'terminee')) return 'termine';
    if (has('en_deplacement')) return 'en_route';
    return 'personne';
  };
  return (
    <div className="card" data-testid="prochains-points">
      <h3>Prochains points {t.progress ? 'devant la tête' : 'depuis le départ'}</h3>
      {next.length === 0 ? <p className="muted small">{t.progress ? 'Aucun point devant la tête du cortège.' : 'Aucun point situé sur le parcours.'}</p> : (
        <ul className="plain small">
          {next.map((p) => {
            const st = POINT_STATE[state(p)];
            return (
              <li key={p.id} className="row" data-testid={'prochain-point-' + p.id}>
                <span className="muted next-dist">{t.progress ? (p.distance - head < 1000 ? Math.round(p.distance - head) + ' m' : km(p.distance - head)) : km(p.distance)}</span>
                <span className="grow"><b>{p.name}</b> <span className="muted">· {p.missions.map((m) => (
                  <span key={m.id}><span className="dot" style={{ background: m.team.color }} /> {m.team.name} </span>
                ))}</span></span>
                <span className={'status-badge ' + st.css}>{st.label}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Statut résumé d'une équipe : le plus urgent d'abord, sinon l'avancement de ses missions. */
function teamSummary(team: Tableau['teams'][number]): { status: string; label: string } {
  const ms = team.missions;
  if (!ms.length) return { status: 'affectee', label: team.kind === 'points' ? 'Aucune mission' : TEAM_KIND_SHORT[team.kind] ?? team.kind };
  for (const s of ['incident', 'releve_necessaire']) if (ms.some((m) => m.status === s)) return { status: s, label: MISSION_STATUS[s]! };
  const n = (s: string) => ms.filter((m) => m.status === s).length;
  if (n('terminee') === ms.length) return { status: 'terminee', label: 'Terminée' };
  if (n('en_position') + n('terminee') === ms.length) return { status: 'en_position', label: 'En position ' + n('en_position') + '/' + ms.length };
  if (n('en_deplacement')) return { status: 'en_deplacement', label: 'En route · ' + n('en_position') + '/' + ms.length + ' en position' };
  if (n('en_position')) return { status: 'en_position', label: n('en_position') + '/' + ms.length + ' en position' };
  return { status: 'affectee', label: MISSION_STATUS.affectee! };
}

/** État de chaque équipe et raccourcis pour joindre son responsable (appel, SMS, message dans l'application). */
function TeamsStatus({ eventId, t, canEdit, act }: {
  eventId: number; t: Tableau; canEdit: boolean; act: (fn: () => Promise<unknown>, ok: string) => Promise<boolean>;
}) {
  const [writing, setWriting] = useState<number | null>(null);
  const [body, setBody] = useState('');
  const teams = t.teams.filter((x) => !x.disabled);
  if (!teams.length) return null;
  return (
    <div className="card" data-testid="etat-equipes">
      <h3>Équipes</h3>
      <ul className="plain team-status">
        {teams.map((team) => {
          const sum = teamSummary(team);
          return (
            <li key={team.id} data-testid={'etat-equipe-' + team.id}>
              <p className="row">
                <span className="dot" style={{ background: team.color }} />
                <b className="grow">{team.name}</b>
                <span className={'status-badge s-' + sum.status}>{sum.label}</span>
              </p>
              <p className="row small">
                <span className="muted grow">
                  {team.leaders.length ? 'Resp. ' + team.leaders.map((l) => l.displayName).join(', ') : 'Pas de responsable'}
                  {' · '}{team.active}/{team.members} actif(s)
                </span>
                {team.leaders.filter((l) => l.phone).slice(0, 1).map((l) => (
                  <span key={l.id} className="row">
                    <a className="button" href={'tel:' + l.phone} aria-label={'Appeler ' + l.displayName} title={formatPhone(l.phone!)}>📞</a>
                    <a className="button" href={'sms:' + l.phone} aria-label={'SMS à ' + l.displayName}>💬</a>
                  </span>
                ))}
                {canEdit && (
                  <button onClick={() => { setWriting(writing === team.id ? null : team.id); setBody(''); }} aria-label={'Message à l’équipe ' + team.name}
                    aria-expanded={writing === team.id}>✉</button>
                )}
              </p>
              {writing === team.id && (
                <form className="row" onSubmit={async (e: FormEvent) => {
                  e.preventDefault();
                  if (await act(() => api.post('/api/events/' + eventId + '/messages', { body, teamId: team.id, urgent: false }), 'Message envoyé à ' + team.name + '.')) setWriting(null);
                }}>
                  <input className="grow" value={body} onChange={(e) => setBody(e.target.value)} required maxLength={2000} placeholder={'Message à ' + team.name} aria-label={'Message à ' + team.name} autoFocus />
                  <button className="primary">Envoyer</button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
