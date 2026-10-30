// Coordination en direct, pensée pour le téléphone : tableau de bord, incidents, équipes, messages et carte, en onglets
// avec une barre en bas d'écran. La planification (parcours, suggestions, répartition) reste sur l'interface bureau.
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../api';
import { InstallCard } from '../components/InstallCard';
import { LiveMap, type LivePoint } from '../components/LiveMap';
import { toMapIncidents } from '../components/incidentMarkers';
import { INCIDENT_CATEGORY } from '../components/FieldView';
import type { MemberPosition } from '../components/MapView';
import type { EventInfo, Position, Track } from '../types';
import { ago, useLive } from '../useLive';
import { CoordinationPanel, type CoordSection, type Tableau } from './event/CoordinationPanel';

type Tab = CoordSection | 'carte';
const TABS: [Tab, string, string][] = [
  ['synthese', 'Direct', '📊'], ['incidents', 'Incidents', '⚠'], ['equipes', 'Équipes', '👥'], ['messages', 'Messages', '✉'], ['carte', 'Carte', '🗺'],
];
const PREF = 'cortege.direct.onglet';

export function LiveCoordPage({ eventId }: { eventId: number }) {
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(() => { try { return (sessionStorage.getItem(PREF) as Tab) || 'synthese'; } catch { return 'synthese'; } });
  const [tick, setTick] = useState(0);
  const [counts, setCounts] = useState({ incidents: 0, messages: 0 });
  const [members, setMembers] = useState<MemberPosition[]>([]);
  const [track, setTrack] = useState<Position[][]>([]);
  const [tableau, setTableau] = useState<Tableau | null>(null);
  const base = '/api/events/' + eventId;
  const organizer = event?.role === 'organisateur';
  const showMembers = !!event && organizer && event.locationSharing;

  useEffect(() => {
    api.get<EventInfo>(base).then(setEvent, (e) => setError(e instanceof ApiError ? e.message : 'Manifestation inaccessible.'));
    api.get<{ track: Track | null }>(base + '/track').then((t) => setTrack(t.track?.geometry.coordinates ?? []), () => undefined);
  }, [base]);
  const loadMembers = useCallback(() => {
    if (showMembers) api.get<MemberPosition[]>(base + '/positions').then(setMembers, () => undefined);
  }, [base, showMembers]);
  useEffect(() => { loadMembers(); }, [loadMembers]);
  const live = useLive(eventId, async () => { setTick((n) => n + 1); }, 30_000, loadMembers);
  // La carte a besoin des points et incidents : rechargés seulement quand elle est affichée.
  useEffect(() => {
    if (tab === 'carte') api.get<Tableau>(base + '/tableau').then(setTableau, () => undefined);
  }, [tab, tick, base]);

  const choose = (t: Tab) => {
    setTab(t);
    try { sessionStorage.setItem(PREF, t); } catch { /* non mémorisé */ }
    window.scrollTo(0, 0);
  };

  if (error) return <main className="page"><p className="error">{error}</p><a href="#/">Retour</a></main>;
  if (!event) return <div className="center">Chargement…</div>;

  const points: LivePoint[] = (tableau?.teams ?? []).filter((t) => !t.disabled).flatMap((t) => t.missions.map((m) => ({
    position: m.position, label: m.pointName + ' (' + t.name + ')', status: m.status, passedByTail: m.passedByTail,
  })));
  const incidents = toMapIncidents(tableau?.incidents ?? [], INCIDENT_CATEGORY);

  return (
    <div className="live-coord" data-testid="coordination-mobile">
      <header className="live-head">
        <div className="row">
          <a href="#/" aria-label="Manifestations" className="back">‹</a>
          <h1 className="grow">{event.name}</h1>
          <span className={'sync ' + (live.connected ? 'on' : 'off')}>{live.connected ? '● direct' : '○ ' + ago(live.syncedAt)}</span>
        </div>
        <div className="row small">
          <span className="muted grow">Coordination en direct</span>
          <a href={'#/evenements/' + eventId}>🗺 Planification</a>
        </div>
      </header>

      <main className="live-body">
        <InstallCard compact dismissible />
        {tab === 'carte'
          ? <LiveMap track={track} points={points} incidents={incidents} members={members} />
          : <CoordinationPanel event={event} canEdit={organizer} liveTick={tick} members={showMembers ? members : null} sections={[tab]} onCounts={setCounts} />}
      </main>

      <nav className="live-tabs" role="tablist" aria-label="Coordination">
        {TABS.map(([id, label, icon]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => choose(id)}>
            <span className="icon" aria-hidden>{icon}</span>
            <span>{label}</span>
            {id === 'incidents' && counts.incidents > 0 && <span className="count">{counts.incidents}</span>}
          </button>
        ))}
      </nav>
    </div>
  );
}
