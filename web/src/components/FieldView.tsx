// Vue terrain (téléphone) d'une équipe : ma mission, grands boutons de statut, itinéraire, messages, incidents.
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, api } from '../api';
import { MISSION_STATUS, SUGGESTION_TYPES, TEAM_KIND, km } from '../labels';
import type { Position, TeamKind } from '../types';
import { ago, useLive } from '../useLive';
import guideMembre from '../../../docs/guide-membre.md?raw';
import { FieldMap } from './FieldMap';
import { Markdown } from './Markdown';
import { OwnTracksCard, type OwnTracksState } from './OwnTracksCard';
import { TeamAccess } from './TeamAccess';
import { useSharing } from './useSharing';

export interface FieldMission {
  id: number; version: number; order: number; status: string; instructions: string; statusChangedAt: string | null;
  point: { name: string; type: string; description: string; position: Position; distance: number | null };
  /** La queue du cortège a dépassé ce point. */
  passedByTail: boolean;
}
export interface FieldMessage { id: number; teamId: number | null; body: string; urgent: boolean; createdAt: string; authorName: string; fromOrganisation: boolean; read?: boolean }
export interface FieldIncident {
  id: number; teamId: number | null; missionId: number | null; pointName: string | null; category: string; priority: string; status: string;
  description: string; reporterName: string | null; handledByName: string | null; createdAt: string; updatedAt: string; version: number;
  teamName?: string | null; position?: Position | null;
}
export interface Progress { distance: number; note: string; at: string; authorName: string | null }
export interface Terrain {
  me: { id: number; displayName: string; role: 'membre' | 'responsable'; organizer: boolean; member: boolean };
  event: { id: number; name: string; startsAt: string | null; instructions: string; status: string };
  team: { id: number; name: string; color: string; instructions: string; leaderName: string | null; closed: boolean; kind: TeamKind };
  missions: FieldMission[];
  messages: FieldMessage[];
  incidents: FieldIncident[];
  track: Position[][];
  /** Tête et queue du cortège déclarées. */
  progress: Progress | null;
  tail: Progress | null;
  canDeclare: { tete: boolean; queue: boolean };
  /** Peut prendre en charge et clore les incidents affichés (volante, responsable, organisation). */
  canHandleIncidents: boolean;
  /** Peut ajouter ou retirer des membres depuis la vue terrain (responsable autorisé, organisation). */
  canManageMembers: boolean;
  /** Points tenus par toutes les équipes (équipes sans point fixe). */
  eventPoints: { name: string; position: Position; distance: number | null; status: string; teamName: string; color: string }[];
  routing: boolean;
  /** Partage de position autorisé par l'organisation ; `sharing` : ce compte partage actuellement. */
  locationSharing: boolean;
  sharing: boolean;
  /** OwnTracks configuré sur un téléphone de ce membre. */
  owntracks: OwnTracksState | null;
}

export const INCIDENT_CATEGORY: Record<string, string> = {
  aide: 'Besoin d’aide', securite: 'Sécurité', sante: 'Santé / secours', circulation: 'Circulation / véhicule', materiel: 'Matériel', autre: 'Autre',
};
export const INCIDENT_STATUS: Record<string, string> = { ouvert: 'Ouvert', pris_en_charge: 'Pris en charge', resolu: 'Résolu' };

/** Grands boutons proposés selon le statut (transitions autorisées aux membres côté serveur). */
const ACTIONS: Record<string, { to: string; label: string; primary?: boolean }[]> = {
  affectee: [{ to: 'en_deplacement', label: 'En route', primary: true }, { to: 'en_position', label: 'Arrivé' }],
  en_deplacement: [{ to: 'en_position', label: 'Arrivé', primary: true }],
  en_position: [{ to: 'terminee', label: 'Terminé', primary: true }, { to: 'releve_necessaire', label: 'Relève nécessaire' }],
  releve_necessaire: [{ to: 'en_position', label: 'Toujours en position' }, { to: 'terminee', label: 'Terminé', primary: true }],
  incident: [{ to: 'en_position', label: 'Reprendre la position', primary: true }, { to: 'en_deplacement', label: 'En route' }, { to: 'terminee', label: 'Terminé' }],
};

type Tab = 'mission' | 'messages' | 'incidents' | 'aide';

const meters = (m: number) => (m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(1).replace('.', ',') + ' km');
const minutes = (s: number) => Math.max(1, Math.round(s / 60)) + ' min';
/**
 * Lien qui ouvre l'application de navigation du téléphone vers un point : Android propose le choix de l'application
 * (lien geo:), iPhone ouvre Plans en itinéraire à pied, un ordinateur ouvre Google Maps dans le navigateur.
 */
export function gpsLink(to: Position, label: string, ua = navigator.userAgent): { href: string; external: boolean } {
  const [lon, lat] = to.map((v) => v.toFixed(6));
  if (/android/i.test(ua)) return { href: 'geo:' + lat + ',' + lon + '?q=' + lat + ',' + lon + '(' + encodeURIComponent(label) + ')', external: false };
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) {
    return { href: 'https://maps.apple.com/?daddr=' + lat + ',' + lon + '&dirflg=w&q=' + encodeURIComponent(label), external: true };
  }
  return { href: 'https://www.google.com/maps/dir/?api=1&destination=' + lat + ',' + lon + '&travelmode=walking', external: true };
}

function GpsButton({ to, label, big }: { to: Position; label: string; big?: boolean }) {
  const l = gpsLink(to, label);
  return (
    <a className={'button' + (big ? ' big' : '')} href={l.href} {...(l.external ? { target: '_blank', rel: 'noreferrer' } : {})}
      aria-label={'Ouvrir l’application GPS vers ' + label}>🧭 GPS</a>
  );
}

const osmDirections = (from: Position | null, to: Position) =>
  'https://www.openstreetmap.org/directions?engine=fossgis_osrm_foot&route=' +
  (from ? from[1] + '%2C' + from[0] : '') + '%3B' + to[1] + '%2C' + to[0] + '#map=17/' + to[1] + '/' + to[0];

export function FieldView({ teamId, header, onUnauthorized }: { teamId: number; header?: ReactNode; onUnauthorized?: () => void }) {
  const scroller = useRef<HTMLElement>(null);
  const [data, setData] = useState<Terrain | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [tab, setTab] = useState<Tab>('mission');
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState<Position | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [route, setRoute] = useState<{ geometry: Position[]; distance: number; duration: number } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [, tick] = useState(0);

  const load = useCallback(async () => {
    try {
      setData(await api.get<Terrain>('/api/terrain/equipes/' + teamId));
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 404)) onUnauthorized?.();
      setError('Connexion impossible : les informations affichées peuvent être anciennes.');
      throw e;
    }
  }, [teamId, onUnauthorized]);
  const live = useLive(data?.event.id ?? null, load);
  const sharing = useSharing({
    teamId,
    allowed: !!data?.locationSharing,
    onPosition: (p) => { setMe(p); setGeoError(null); },
    onArrived: (name) => { setToast({ kind: 'ok', text: 'Arrivée détectée à « ' + name + ' » : vous êtes « en position ».' }); void load().catch(() => undefined); },
    onError: (text) => setToast({ kind: 'error', text }),
  });
  useEffect(() => { load().then(live.markSynced, () => undefined); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [load]);
  // Rafraîchit les « il y a … min ».
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(t); }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t); }, [toast]);

  // Mission courante : la première non terminée (ou celle choisie dans la liste).
  const current = useMemo(() => {
    if (!data) return null;
    return data.missions.find((m) => m.id === selected) ?? data.missions.find((m) => m.status !== 'terminee') ?? null;
  }, [data, selected]);
  const next = data && current ? data.missions.find((m) => m.order > current.order && m.status !== 'terminee') ?? null : null;
  const unread = data?.messages.filter((m) => m.read === false).length ?? 0;
  const openIncidents = data?.incidents.filter((i) => i.status !== 'resolu').length ?? 0;

  // Messages lus quand l'onglet est affiché.
  useEffect(() => {
    if (tab !== 'messages' || !data) return;
    const ids = data.messages.filter((m) => m.read === false).map((m) => m.id);
    if (!ids.length) return;
    void Promise.all(ids.map((id) => api.post('/api/messages/' + id + '/lu').catch(() => undefined))).then(() => load().catch(() => undefined));
  }, [tab, data, load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      setToast({ kind: 'ok', text: ok });
      await load().catch(() => undefined);
      return true;
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof ApiError ? e.message : 'Action impossible : vérifiez la connexion et réessayez.' });
      await load().catch(() => undefined);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const locate = () => new Promise<Position | null>((resolve) => {
    if (!navigator.geolocation) { setGeoError('Position indisponible sur cet appareil.'); resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => { const pos: Position = [p.coords.longitude, p.coords.latitude]; setMe(pos); setGeoError(null); resolve(pos); },
      () => { setGeoError('Position refusée ou indisponible.'); resolve(null); },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );
  });

  const itinerary = async () => {
    if (!current) return;
    const from = me ?? (await locate());
    if (!data?.routing || !from) {
      window.open(osmDirections(from, current.point.position), '_blank', 'noopener');
      return;
    }
    try {
      setRoute(await api.get('/api/terrain/itineraire?from=' + from.join(',') + '&to=' + current.point.position.join(',')));
    } catch (e) {
      setToast({ kind: 'error', text: (e instanceof ApiError ? e.message : 'Itinéraire indisponible.') + ' Ouverture d’une carte externe.' });
      window.open(osmDirections(from, current.point.position), '_blank', 'noopener');
    }
  };
  useEffect(() => setRoute(null), [current?.id]);

  if (!data) return <div className="center">{error ?? 'Chargement…'}</div>;
  const progressTo = (m: FieldMission) => (data.progress && m.point.distance !== null ? m.point.distance - data.progress.distance : null);

  return (
    <main ref={scroller} className="field" data-testid="vue-terrain" style={{ ['--team' as string]: data.team.color }}>
      <header className="field-header">
        {header}
        <div className="row">
          <h1 className="grow"><span className="dot" style={{ background: data.team.color }} /> {data.team.name}</h1>
          <span className={'sync ' + (live.connected ? 'on' : 'off')} title={live.connected ? 'Connecté en direct' : 'Hors direct : rechargement régulier'} data-testid="synchro">
            {live.connected ? '● direct' : '○ ' + ago(live.syncedAt)}
          </span>
        </div>
        <p className="muted small">
          {data.event.name} · {data.me.displayName}{data.me.role === 'responsable' ? ' (responsable)' : ''}
          {data.team.leaderName ? ' · responsable : ' + data.team.leaderName : ''}
        </p>
        {error && <p className="warning small" role="alert">{error}</p>}
        {data.team.closed && <p className="warning small">Équipe désactivée par l’organisation.</p>}
      </header>

      <nav className="field-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'mission'} onClick={() => setTab('mission')}>Mission</button>
        <button role="tab" aria-selected={tab === 'messages'} onClick={() => setTab('messages')}>Messages{unread ? <span className="count">{unread}</span> : null}</button>
        <button role="tab" aria-selected={tab === 'incidents'} onClick={() => setTab('incidents')}>Incidents{openIncidents ? <span className="count">{openIncidents}</span> : null}</button>
        <button role="tab" aria-selected={tab === 'aide'} onClick={() => setTab('aide')} aria-label="Aide" className="help-tab">?</button>
      </nav>

      {tab === 'mission' && (
        <section className="stack">
          {data.messages.some((m) => m.urgent && m.read === false) && (
            <button className="urgent-banner" onClick={() => setTab('messages')}>⚠ Message urgent de l’organisation — lire</button>
          )}
          {data.locationSharing && data.me.member && (
            <div className={'card small' + (sharing.on ? ' sharing' : '')} data-testid="partage-position">
              {sharing.on ? (
                <div className="row">
                  <span className="grow">📡 <b>Position partagée avec l’organisation</b>{sharing.lastSent ? ' · envoyée ' + ago(sharing.lastSent) : ''}.
                    {data.team.kind === 'points' ? ' L’arrivée au point est enregistrée automatiquement.' : ''}</span>
                  <button onClick={() => void sharing.stop()}>Arrêter</button>
                </div>
              ) : (
                <div className="row">
                  <span className="grow">L’organisation peut suivre les équipes en direct si vous partagez votre position (facultatif).</span>
                  <button className="primary" onClick={sharing.start}>Partager ma position</button>
                </div>
              )}
              <p className="muted">Seulement tant que l’application est ouverte à l’écran ; dernière position seulement, effacée à l’arrêt.</p>
            </div>
          )}
          {data.locationSharing && data.me.member && (
            <OwnTracksCard teamId={teamId} state={data.owntracks} reload={load} notify={setToast} />
          )}
          <Progression data={data} reload={load} setToast={setToast} locate={locate} />
          {data.team.kind !== 'points' && <RoleCard data={data} openIncidents={() => setTab('incidents')} />}
          {!current ? (data.team.kind !== 'points' ? null :
            <div className="card"><p>{data.missions.length ? 'Toutes les missions de l’équipe sont terminées. Merci !' : 'Aucune mission pour l’instant.'}</p></div>
          ) : (
            <div className="card mission-card" data-testid="ma-mission">
              <p className="muted small">Point {current.order} sur {data.missions.length} · {SUGGESTION_TYPES[current.point.type] ?? current.point.type} · {km(current.point.distance)}</p>
              <h2>{current.point.name}</h2>
              <p><span className={'status-badge s-' + current.status}>{MISSION_STATUS[current.status] ?? current.status}</span>
                {current.statusChangedAt && <span className="muted small"> {ago(current.statusChangedAt)}</span>}</p>
              {progressTo(current) !== null && (
                <p className="small">{progressTo(current)! > 0 ? 'Tête du cortège à ' + meters(progressTo(current)!) + ' de ce point.' : 'La tête du cortège a dépassé ce point.'}</p>
              )}
              {current.passedByTail && current.status !== 'terminee' && (
                <p className="warning small" data-testid="queue-passee">La fermeture du cortège a dépassé ce point : vous pourrez le lever sur instruction de l’organisation.</p>
              )}
              {current.point.description && <p className="pre small">{current.point.description}</p>}
              {current.instructions && <p className="pre"><b>Consignes :</b> {current.instructions}</p>}
              <div className="big-actions">
                {(ACTIONS[current.status] ?? []).map((a) => (
                  <button key={a.to} className={'big' + (a.primary ? ' primary' : '')} disabled={busy}
                    onClick={() => act(() => api.post('/api/terrain/missions/' + current.id + '/statut', { status: a.to, version: current.version }), MISSION_STATUS[a.to] + ' : c’est noté.')}>
                    {a.label}
                  </button>
                ))}
              </div>
              <div className="row">
                <button className="big danger" disabled={busy} onClick={() => act(() => api.post('/api/terrain/equipes/' + teamId + '/incidents', {
                  category: 'aide', description: 'Demande d’aide depuis « ' + current.point.name + ' »', missionId: current.id, position: me,
                }), 'Demande d’aide envoyée à l’organisation.')}>🆘 Aide</button>
                <button className="big" onClick={() => setTab('incidents')}>Signaler un incident</button>
              </div>
              <div className="row">
                <GpsButton to={current.point.position} label={current.point.name} big />
              </div>
            </div>
          )}

          {(current || data.team.kind !== 'points') && (
            <div className="card">
              <FieldMap
                track={data.track}
                color={data.team.color}
                me={me}
                route={route?.geometry ?? null}
                points={[
                  ...data.eventPoints.map((p) => ({ position: p.position, label: p.name + ' (' + p.teamName + ')', current: false, done: p.status === 'terminee', color: p.color })),
                  ...data.missions.map((m) => ({ position: m.point.position, label: m.point.name, current: m.id === current?.id, done: m.status === 'terminee' })),
                ]}
              />
              <div className="row small">
                <button onClick={() => void locate()}>📍 Ma position</button>
                {current && <button onClick={() => void itinerary()}>Itinéraire à pied</button>}
                {route && <span className="muted">{meters(route.distance)} · environ {minutes(route.duration)}</span>}
              </div>
              {geoError && <p className="muted small">{geoError}</p>}
              <p className="muted small">
                Votre position reste sur ce téléphone (elle n’est envoyée que pour calculer un itinéraire, sans être conservée).
                Itinéraire indicatif : vérifiez sur place l’accès et la sécurité du trajet.
              </p>
            </div>
          )}

          {next && (
            <div className="card small row" data-testid="point-suivant">
              <span className="grow">Point suivant : <b>{next.point.name}</b> <span className="muted">({km(next.point.distance)})</span></span>
              <GpsButton to={next.point.position} label={next.point.name} />
            </div>
          )}

          {(data.event.instructions || data.team.instructions) && (
            <details className="card">
              <summary>Consignes</summary>
              {data.event.instructions && <><h3>Générales</h3><p className="pre">{data.event.instructions}</p></>}
              {data.team.instructions && <><h3>De l’équipe</h3><p className="pre">{data.team.instructions}</p></>}
            </details>
          )}

          {data.canManageMembers && (
            <details className="card">
              <summary>Gérer les membres de l’équipe</summary>
              <TeamAccess teamId={teamId} organizer={data.me.organizer} onChanged={load} />
            </details>
          )}

          <details className="card" open={data.missions.length > 1}>
            <summary>Toutes les missions ({data.missions.length})</summary>
            <ol className="missions">
              {data.missions.map((m) => (
                <li key={m.id}>
                  <button className="link" onClick={() => { setSelected(m.id); scroller.current?.scrollTo({ top: 0, behavior: 'smooth' }); }}>{m.point.name}</button>
                  <span className="muted small"> — {MISSION_STATUS[m.status] ?? m.status}{m.id === current?.id ? ' (affichée)' : ''}</span>
                </li>
              ))}
            </ol>
          </details>
        </section>
      )}

      {tab === 'messages' && <Messages data={data} teamId={teamId} act={act} busy={busy} />}
      {tab === 'incidents' && <Incidents data={data} teamId={teamId} current={current} me={me} locate={locate} act={act} busy={busy} />}

      {tab === 'aide' && <section className="card" data-testid="aide-membre"><Markdown source={guideMembre} toc /></section>}

      {toast && <div className={'toast ' + toast.kind} role="status">{toast.text}</div>}
    </main>
  );
}

const PART: Record<'tete' | 'queue', { title: string; here: string }> = {
  tete: { title: 'Tête du cortège', here: '📍 La tête est ici' },
  queue: { title: 'Queue du cortège', here: '📍 La queue est ici' },
};

function Progression({ data, reload, setToast, locate }: {
  data: Terrain; reload: () => Promise<void>; setToast: (t: { kind: 'ok' | 'error'; text: string }) => void; locate: () => Promise<Position | null>;
}) {
  const [value, setValue] = useState<Record<string, string>>({});
  const send = async (part: 'tete' | 'queue', body: Record<string, unknown>) => {
    try {
      await api.post('/api/events/' + data.event.id + '/progression', { part, ...body });
      setValue((v) => ({ ...v, [part]: '' }));
      setToast({ kind: 'ok', text: PART[part].title + ' déclarée.' });
      await reload();
    } catch (err) {
      setToast({ kind: 'error', text: err instanceof ApiError ? err.message : 'Déclaration impossible.' });
    }
  };
  const parts = (['tete', 'queue'] as const).filter((p) => (p === 'tete' ? data.progress : data.tail) || data.canDeclare[p]);
  if (!parts.length) return null;
  return (
    <div className="card small" data-testid="progression">
      {parts.map((part) => {
        const p = part === 'tete' ? data.progress : data.tail;
        return (
          <div key={part} data-testid={'progression-' + part}>
            {p
              ? <p>{PART[part].title} déclarée au <b>{km(p.distance)}</b> <span className="muted">— {ago(p.at)}{p.note ? ' · ' + p.note : ''}</span></p>
              : <p className="muted">{PART[part].title} : non déclarée.</p>}
            {data.canDeclare[part] && (
              <form className="row" onSubmit={(e: FormEvent) => { e.preventDefault(); void send(part, { distance: Math.round(Number((value[part] ?? '').replace(',', '.')) * 1000) }); }}>
                <button type="button" className={data.team.kind === (part === 'tete' ? 'ouverture' : 'fermeture') ? 'big primary' : ''}
                  onClick={async () => { const pos = await locate(); if (pos) void send(part, { position: pos }); else setToast({ kind: 'error', text: 'Position indisponible : indiquez les km.' }); }}>
                  {PART[part].here}
                </button>
                <input inputMode="decimal" placeholder="ou km (ex. 2,4)" value={value[part] ?? ''} onChange={(e) => setValue((v) => ({ ...v, [part]: e.target.value }))}
                  aria-label={PART[part].title + ' : distance parcourue en km'} required pattern="\d+([.,]\d+)?" />
                <button>Déclarer</button>
              </form>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Rôle d'une équipe sans point fixe. */
function RoleCard({ data, openIncidents }: { data: Terrain; openIncidents: () => void }) {
  const open = data.incidents.filter((i) => i.status !== 'resolu');
  const behindTail = data.tail ? data.eventPoints.filter((p) => p.distance !== null && p.distance <= data.tail!.distance && p.status !== 'terminee') : [];
  return (
    <div className="card mission-card" data-testid="role-equipe">
      <h2>{TEAM_KIND[data.team.kind]}</h2>
      {data.team.kind === 'volante' && (
        <>
          <p>Pas de point fixe : vous intervenez là où l’organisation ou les équipes en ont besoin. Les incidents de toute la manifestation s’affichent ici.</p>
          <button className="big primary" onClick={openIncidents}>{open.length ? open.length + ' incident(s) en cours' : 'Aucun incident en cours'}</button>
        </>
      )}
      {data.team.kind === 'ouverture' && <p>Vous ouvrez le cortège : déclarez régulièrement la position de la tête (bouton ci-dessus). Les équipes voient à quelle distance elle se trouve de leur point.</p>}
      {data.team.kind === 'fermeture' && (
        <>
          <p>Vous fermez le cortège : déclarez régulièrement la position de la queue. Les points dépassés pourront être levés sur instruction de l’organisation.</p>
          {data.tail && <p className="small">{behindTail.length ? behindTail.length + ' point(s) dépassé(s), encore tenu(s) : ' + behindTail.map((p) => p.name).join(', ') : 'Aucun point dépassé encore tenu.'}</p>}
        </>
      )}
    </div>
  );
}

function Messages({ data, teamId, act, busy }: { data: Terrain; teamId: number; act: (fn: () => Promise<unknown>, ok: string) => Promise<boolean>; busy: boolean }) {
  const [body, setBody] = useState('');
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (await act(() => api.post('/api/terrain/equipes/' + teamId + '/messages', { body }), 'Message envoyé.')) setBody('');
  };
  return (
    <section className="stack" data-testid="messages">
      <form className="stack" onSubmit={send}>
        <textarea rows={2} placeholder="Message à l’équipe et à l’organisation" value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} required aria-label="Votre message" />
        <button className="primary" disabled={busy}>Envoyer</button>
      </form>
      {data.messages.length === 0 && <p className="muted">Aucun message.</p>}
      <ul className="plain messages-list">
        {data.messages.map((m) => (
          <li key={m.id} className={'message' + (m.urgent ? ' urgent' : '') + (m.read === false ? ' unread' : '') + (m.fromOrganisation ? ' orga' : '')}>
            <p className="small muted">
              <b>{m.fromOrganisation ? 'Organisation' : m.authorName}</b>{m.fromOrganisation && m.authorName !== 'Organisation' ? ' (' + m.authorName + ')' : ''}
              {m.teamId === null ? ' · à tous' : ''} · {ago(m.createdAt)}{m.urgent ? ' · URGENT' : ''}
            </p>
            <p className="pre">{m.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Incidents({ data, teamId, current, me, locate, act, busy }: {
  data: Terrain; teamId: number; current: FieldMission | null; me: Position | null; locate: () => Promise<Position | null>;
  act: (fn: () => Promise<unknown>, ok: string) => Promise<boolean>; busy: boolean;
}) {
  const [category, setCategory] = useState('securite');
  const [description, setDescription] = useState('');
  const [onMission, setOnMission] = useState(true);
  const [withPosition, setWithPosition] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const position = withPosition ? me ?? (await locate()) : null;
    const ok = await act(() => api.post('/api/terrain/equipes/' + teamId + '/incidents', {
      category, description, missionId: onMission && current ? current.id : null, position,
    }), 'Incident signalé à l’organisation.');
    if (ok) setDescription('');
  };
  return (
    <section className="stack" data-testid="incidents">
      <form className="card stack" onSubmit={submit}>
        <h2>Signaler un incident</h2>
        <label>Nature
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {Object.entries(INCIDENT_CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>Description<textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} /></label>
        {current && <label className="check"><input type="checkbox" checked={onMission} onChange={(e) => setOnMission(e.target.checked)} /> Concerne « {current.point.name} »</label>}
        <label className="check"><input type="checkbox" checked={withPosition} onChange={(e) => setWithPosition(e.target.checked)} /> Joindre ma position actuelle</label>
        <button className="big danger" disabled={busy}>Envoyer le signalement</button>
        <p className="muted small">En cas d’urgence vitale, appelez le 15, le 17, le 18 ou le 112 : ce signalement ne les prévient pas.</p>
      </form>
      {data.incidents.length === 0 && <p className="muted">Aucun incident récent pour l’équipe.</p>}
      <ul className="plain">
        {data.incidents.map((i) => (
          <li key={i.id} className={'card incident p-' + i.priority + ' st-' + i.status}>
            <p><b>{INCIDENT_CATEGORY[i.category] ?? i.category}</b> — {INCIDENT_STATUS[i.status]}{i.handledByName && i.status !== 'ouvert' ? ' par ' + i.handledByName : ''}</p>
            {i.description && <p className="pre small">{i.description}</p>}
            <p className="muted small">{i.teamName && i.teamId !== teamId ? i.teamName + ' · ' : ''}{i.pointName ? i.pointName + ' · ' : ''}{i.reporterName ?? ''} · {ago(i.createdAt)}</p>
            {data.canHandleIncidents && i.status !== 'resolu' && (
              <div className="row">
                {i.position && <GpsButton to={i.position} label={INCIDENT_CATEGORY[i.category] ?? 'Incident'} />}
                {i.status === 'ouvert' && <button className="primary" disabled={busy} onClick={() => act(() => api.patch('/api/incidents/' + i.id, { status: 'pris_en_charge', version: i.version }), 'Vous prenez l’incident en charge.')}>J’y vais</button>}
                <button disabled={busy} onClick={() => act(() => api.patch('/api/incidents/' + i.id, { status: 'resolu', version: i.version }), 'Incident résolu.')}>Résolu</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
