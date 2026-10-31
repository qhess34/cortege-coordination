// Coordination en direct, pensée pour le téléphone : tableau de bord, SOS, équipes, messages et carte, en onglets
// avec une barre en bas d'écran. La planification (parcours, suggestions, répartition) reste sur l'interface bureau.
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../api';
import { InstallCard } from '../components/InstallCard';
import { LiveMap, type LivePoint } from '../components/LiveMap';
import { toMapSos } from '../components/sosMarkers';
import type { MemberPosition } from '../components/MapView';
import type { EventInfo, Position, Track } from '../types';
import { ago, useLive } from '../useLive';
import { CoordinationPanel, placeGroups, type CoordSection, type PlaceGroup, type Tableau } from './event/CoordinationPanel';

type Tab = CoordSection | 'carte';
const TABS: [Tab, string, string][] = [
  ['synthese', 'Direct', '📊'], ['sos', 'SOS', '🆘'], ['equipes', 'Équipes', '👥'], ['messages', 'Messages', '✉'], ['carte', 'Carte', '🗺'],
];
const PREF = 'cortege.direct.onglet';
/** Couleur d'un lieu sur la carte : celle du statut de mission correspondant à son état. */
const STATE_STATUS: Record<PlaceGroup['state'], string> = {
  sos: 'sos', releve: 'releve_necessaire', en_position: 'en_position', en_route: 'en_deplacement', personne: 'affectee', termine: 'terminee',
};

export function LiveCoordPage({ eventId }: { eventId: number }) {
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(() => { try { return (sessionStorage.getItem(PREF) as Tab) || 'synthese'; } catch { return 'synthese'; } });
  const [tick, setTick] = useState(0);
  const [counts, setCounts] = useState({ sos: 0, messages: 0 });
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
  // La carte a besoin des points et SOS : rechargés seulement quand elle est affichée.
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

  // Un marqueur par lieu (les accès d'un carrefour regroupés), à la couleur de son état le plus grave.
  const points: LivePoint[] = tableau ? placeGroups(tableau).map((g) => ({
    position: g.position, label: g.name + (g.accesses > 1 ? ' (' + g.held + '/' + g.accesses + ' accès tenus)' : ''),
    status: STATE_STATUS[g.state], passedByTail: g.passedByTail,
  })) : [];
  const sos = toMapSos(tableau?.sos ?? []);

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
          ? <LiveMap track={track} points={points} sos={sos} members={members} />
          : <CoordinationPanel event={event} canEdit={organizer} liveTick={tick} members={showMembers ? members : null} sections={[tab]} onCounts={setCounts} />}
      </main>

      <nav className="live-tabs" role="tablist" aria-label="Coordination">
        {TABS.map(([id, label, icon]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => choose(id)}>
            <span className="icon" aria-hidden>{icon}</span>
            <span>{label}</span>
            {id === 'sos' && counts.sos > 0 && <span className="count">{counts.sos}</span>}
          </button>
        ))}
      </nav>
    </div>
  );
}
