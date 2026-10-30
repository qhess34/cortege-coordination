// Tableau de bord partagé du jour J : progression du cortège, SOS, état des équipes, messages.
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../api';
import { SOS_STATUS, type FieldSos, type Progress } from '../../components/FieldView';
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
      /** Lieu (carrefour) regroupant ce point avec d'autres accès. */
      place: { id: number; name: string; position: Position } | null;
      distance: number | null; position: Position; passedByTail: boolean;
    }[];
  }[];
  sos: (FieldSos & { teamName: string | null; position: Position | null })[];
  progress: Progress | null;
  tail: Progress | null;
  live: number;
}
interface OrgMessage { id: number; teamId: number | null; teamName: string | null; body: string; urgent: boolean; createdAt: string; authorName: string; fromOrganisation: boolean; reads: number; recipients: number }

/** Ordre d'affichage des statuts (du plus urgent au plus calme). */
const STATUS_ORDER = ['releve_necessaire', 'en_deplacement', 'affectee', 'a_preparer', 'en_position', 'terminee'];

/** Sections du tableau de bord : toutes sur ordinateur, une par onglet sur la vue mobile. */
export type CoordSection = 'synthese' | 'sos' | 'equipes' | 'messages';
const ALL: CoordSection[] = ['synthese', 'sos', 'equipes', 'messages'];

export function CoordinationPanel({ event, canEdit, liveTick, members, sections = ALL, onCounts }: {
  event: { id: number; locationSharing: boolean }; canEdit: boolean;
  liveTick: number; members: MemberPosition[] | null; sections?: CoordSection[];
  /** Compteurs pour les badges d'onglets de la vue mobile. */
  onCounts?: (c: { sos: number; messages: number }) => void;
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
      onCounts?.({ sos: tab.sos.length, messages: msgs.filter((m) => !m.fromOrganisation && Date.now() - new Date(m.createdAt).getTime() < 3600_000).length });
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
  // Points dépassés par la queue du cortège mais encore tenus.
  const toRelease = all.filter((m) => m.passedByTail && m.status !== 'terminee').length;

  return (
    <div className="stack" data-testid="coordination">
      {message && <p className={message.kind === 'ok' ? 'muted small' : 'error small'} role="status">{message.text}</p>}

      {show('synthese') && <>
      <div className="grid-stats">
        <div className="stat"><b className={t.sos.length ? 'alert' : ''}>{t.sos.length}</b><span>SOS ouverts</span></div>
        <div className="stat"><b>{t.progress ? km(t.progress.distance) : '—'}</b><span>Tête du cortège</span></div>
        <div className="stat"><b>{t.tail ? km(t.tail.distance) : '—'}</b><span>Queue du cortège</span></div>
        <div className="stat"><b className={toRelease ? 'alert' : ''}>{toRelease}</b><span>Points à lever</span></div>
      </div>

      <NextPoints t={t} />
      <TeamsStatus eventId={eventId} t={t} canEdit={canEdit} act={act} />
      </>}

      {show('sos') && <div className="card">
        <h3>SOS ouverts ({t.sos.length})</h3>
        {t.sos.length === 0 ? <p className="muted">Aucun SOS en cours.</p> : (
          <ul className="plain">
            {t.sos.map((s) => (
              <li key={s.id} className={'incident st-' + s.status}>
                <p>
                  <b>🆘 {s.type}</b> — {SOS_STATUS[s.status] ?? s.status}
                  {s.handledByName && s.status === 'resolu' ? ' par ' + s.handledByName : ''}
                </p>
                <p className="small">{s.teamName ?? '—'}{s.pointName ? ' · ' + s.pointName : ''} · {s.reporterName ?? ''} · {ago(s.createdAt)}</p>
                {s.message && <p className="pre small">{s.message}</p>}
                <div className="row small">
                  {s.position && <a href={'https://www.openstreetmap.org/?mlat=' + s.position[1] + '&mlon=' + s.position[0] + '#map=18/' + s.position[1] + '/' + s.position[0]} target="_blank" rel="noreferrer">{s.positionSource === 'point' ? 'Lieu (point concerné)' : 'Position signalée'}</a>}
                  {canEdit && s.status !== 'resolu' && <button onClick={() => act(() => api.patch('/api/sos/' + s.id, { resolved: true, version: s.version }), 'SOS résolu.')}>Résolu</button>}
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

/** État d'un point vu de la coordination : le plus grave l'emporte (SOS), puis la présence d'une équipe. */
type PointState = 'sos' | 'releve' | 'en_position' | 'en_route' | 'personne' | 'termine';
const POINT_STATE: Record<PointState, { label: string; css: string }> = {
  sos: { label: '🆘 SOS', css: 's-incident' },
  releve: { label: 'Relève nécessaire', css: 's-releve_necessaire' },
  en_position: { label: '✓ Équipe en position', css: 's-en_position' },
  en_route: { label: 'Personne · équipe en route', css: 's-en_deplacement' },
  personne: { label: 'Personne', css: 's-a_preparer' },
  termine: { label: 'Levé', css: 's-terminee' },
};

type TeamMission = Tableau['teams'][number]['missions'][number] & { team: Tableau['teams'][number] };
/** Un lieu suivi : carrefour (accès regroupés) ou point seul, avec ses missions et son état le plus grave. */
export interface PlaceGroup {
  key: string; name: string; position: Position; distance: number | null; missions: TeamMission[];
  accesses: number; held: number; state: PointState; passedByTail: boolean;
}

/** Regroupe les missions des équipes actives par lieu (les accès d'un même carrefour ensemble). */
export function placeGroups(t: Tableau): PlaceGroup[] {
  const open = t.sos.filter((s) => s.status !== 'resolu');
  const groups = new Map<string, TeamMission[]>();
  for (const team of t.teams.filter((x) => !x.disabled)) {
    for (const m of team.missions) {
      const key = m.place ? 'lieu-' + m.place.id : 'point-' + m.pointId;
      groups.set(key, [...(groups.get(key) ?? []), { ...m, team }]);
    }
  }
  return [...groups.entries()].map(([key, ms]) => {
    const points = new Map(ms.map((m) => [m.pointId, m]));
    const grouped = points.size > 1 && !!ms[0]!.place;
    const ids = new Set(ms.map((m) => m.id));
    const inc = open.filter((s) => s.missionId !== null && ids.has(s.missionId));
    const has = (s: string) => ms.some((m) => m.status === s);
    const state: PointState = inc.length ? 'sos'
      : has('releve_necessaire') ? 'releve'
      : has('en_position') ? 'en_position'
      : ms.every((m) => m.status === 'terminee') ? 'termine'
      : has('en_deplacement') ? 'en_route' : 'personne';
    const distances = ms.map((m) => m.distance).filter((d): d is number => d !== null);
    const held = [...points.keys()].filter((pid) => ms.some((m) => m.pointId === pid && (m.status === 'en_position' || m.status === 'releve_necessaire'))).length;
    return {
      key, name: grouped ? ms[0]!.place!.name : ms[0]!.pointName, position: grouped ? ms[0]!.place!.position : ms[0]!.position,
      distance: distances.length ? Math.min(...distances) : null, missions: ms, accesses: points.size, held, state,
      passedByTail: ms.some((m) => m.passedByTail && m.status !== 'terminee'),
    };
  });
}

/** Prochains lieux devant la tête du cortège (ou depuis le départ si la tête n'est pas connue), avec leur état. */
function NextPoints({ t }: { t: Tableau }) {
  const head = t.progress?.distance ?? 0;
  const next = placeGroups(t).filter((g) => g.distance !== null && g.distance >= head).sort((a, b) => a.distance! - b.distance!).slice(0, 6);
  return (
    <div className="card" data-testid="prochains-points">
      <h3>Prochains points {t.progress ? 'devant la tête' : 'depuis le départ'}</h3>
      {next.length === 0 ? <p className="muted small">{t.progress ? 'Aucun point devant la tête du cortège.' : 'Aucun point situé sur le parcours.'}</p> : (
        <ul className="plain small">
          {next.map((g) => {
            const st = POINT_STATE[g.state];
            const teams = [...new Map(g.missions.map((m) => [m.team.id, m.team])).values()];
            return (
              <li key={g.key} className="row" data-testid={'prochain-' + g.key}>
                <span className="muted next-dist">{t.progress ? (g.distance! - head < 1000 ? Math.round(g.distance! - head) + ' m' : km(g.distance! - head)) : km(g.distance!)}</span>
                <span className="grow"><b>{g.name}</b>
                  {g.accesses > 1 && <span className="muted"> · {g.held}/{g.accesses} accès tenus</span>}
                  <span className="muted"> · {teams.map((x) => (
                    <span key={x.id}><span className="dot" style={{ background: x.color }} /> {x.name} </span>
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
  for (const s of ['releve_necessaire']) if (ms.some((m) => m.status === s)) return { status: s, label: MISSION_STATUS[s]! };
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
