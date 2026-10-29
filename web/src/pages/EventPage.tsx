import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../api';
import { MapView, type Selection } from '../components/MapView';
import type { EventInfo, MissionPoint, Position, Suggestion, Summary, Team, Track, Waypoint } from '../types';
import { HistoryPanel } from './event/HistoryPanel';
import { PointsPanel } from './event/PointsPanel';
import { SuggestionsPanel } from './event/SuggestionsPanel';
import { SummaryPanel } from './event/SummaryPanel';
import { TeamsPanel } from './event/TeamsPanel';
import { TrackPanel } from './event/TrackPanel';

export interface EventData {
  event: EventInfo;
  track: Track | null;
  waypoints: Waypoint[];
  suggestions: Suggestion[];
  points: MissionPoint[];
  teams: Team[];
  summary: Summary;
}

/** Contexte partagé par les panneaux. */
export interface PanelProps {
  data: EventData;
  canEdit: boolean;
  reload: () => Promise<void>;
  /** Exécute une action et affiche l'erreur éventuelle ; renvoie false en cas d'échec. */
  run: (fn: () => Promise<unknown>, success?: string) => Promise<boolean>;
  selection: Selection;
  select: (s: Selection) => void;
}

type Tab = 'synthese' | 'parcours' | 'suggestions' | 'points' | 'equipes' | 'historique';
const TABS: [Tab, string][] = [
  ['synthese', 'Synthèse'], ['parcours', 'Parcours'], ['suggestions', 'Suggestions'], ['points', 'Points'], ['equipes', 'Équipes'], ['historique', 'Historique'],
];

export function EventPage({ eventId }: { eventId: number }) {
  const [data, setData] = useState<EventData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('synthese');
  const [selection, setSelection] = useState<Selection>(null);
  const [addMode, setAddMode] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);

  const base = '/api/events/' + eventId;
  const reload = useCallback(async () => {
    try {
      const [event, t, suggestions, points, teams, summary] = await Promise.all([
        api.get<EventInfo>(base),
        api.get<{ track: Track | null; waypoints?: Waypoint[] }>(base + '/track'),
        api.get<Suggestion[]>(base + '/suggestions'),
        api.get<MissionPoint[]>(base + '/points'),
        api.get<Team[]>(base + '/teams'),
        api.get<Summary>(base + '/summary'),
      ]);
      setData({ event, track: t.track, waypoints: t.waypoints ?? [], suggestions, points, teams, summary });
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : 'Chargement impossible.');
    }
  }, [base]);
  useEffect(() => { void reload(); }, [reload]);

  const run = useCallback(async (fn: () => Promise<unknown>, success?: string) => {
    try {
      await fn();
      if (success) setToast({ kind: 'ok', text: success });
      await reload();
      return true;
    } catch (e) {
      setToast({ kind: 'error', text: e instanceof ApiError ? e.message : 'Erreur inattendue.' });
      if (e instanceof ApiError && e.status === 409) await reload();
      return false;
    }
  }, [reload]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.kind === 'error' ? 8000 : 3000);
    return () => clearTimeout(t);
  }, [toast]);

  if (loadError) return <main className="page"><p className="error">{loadError}</p><a href="#/">Retour</a></main>;
  if (!data) return <div className="center">Chargement…</div>;
  const canEdit = data.event.role === 'organisateur';

  const select = (s: Selection) => {
    setSelection(s);
    if (s?.kind === 'suggestion') setTab('suggestions');
    if (s?.kind === 'point') setTab('points');
  };

  const addPointAt = async (p: Position) => {
    // Création successive de points : le mode ajout reste actif jusqu'à ce qu'on le quitte.
    const n = data.points.filter((x) => x.origin === 'manuel').length + 1;
    await run(async () => {
      const created = await api.post<MissionPoint>(base + '/points', { name: 'Point ' + n, position: p, type: 'autre' });
      setSelection({ kind: 'point', id: created.id });
    }, 'Point ajouté.');
  };

  const movePoint = async (id: number, p: Position) => {
    const point = data.points.find((x) => x.id === id);
    if (!point || !canEdit) return;
    await run(() => api.patch('/api/points/' + id, { version: point.version, position: p }), 'Point déplacé.');
  };

  const props: PanelProps = { data, canEdit, reload, run, selection, select };
  const visibleSuggestions = data.suggestions.filter((s) => s.status === 'a_examiner' || (showDismissed && s.status === 'ecartee'));

  return (
    <div className="event-layout">
      <section className="map-pane">
        <MapView
          track={data.track}
          suggestions={visibleSuggestions}
          points={data.points}
          selection={selection}
          addMode={addMode && canEdit}
          onSelect={select}
          onMapClick={addPointAt}
          onPointMove={movePoint}
        />
        <div className="map-toolbar">
          {canEdit && (
            <button className={addMode ? 'primary' : ''} onClick={() => setAddMode(!addMode)} aria-pressed={addMode}>
              {addMode ? 'Terminer l’ajout' : '+ Ajouter des points'}
            </button>
          )}
          <label className="check"><input type="checkbox" checked={showDismissed} onChange={(e) => setShowDismissed(e.target.checked)} /> Afficher les suggestions écartées</label>
        </div>
        {addMode && <div className="map-hint">Cliquez sur la carte pour créer un point (plusieurs clics = plusieurs points).</div>}
        <div className="disclaimer">
          Suggestions issues d’OpenStreetMap, à vérifier sur le terrain. Elles ne garantissent rien en matière de sécurité
          et ne remplacent ni les autorisations ni les décisions des autorités compétentes.
        </div>
      </section>
      <aside className="side-pane">
        <div className="event-title">
          <h1>{data.event.name}</h1>
          {!canEdit && <span className="badge">lecture seule</span>}
        </div>
        <nav className="tabs" role="tablist">
          {TABS.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
              {label}
              {id === 'suggestions' && data.summary.suggestions.a_examiner ? <span className="count">{data.summary.suggestions.a_examiner}</span> : null}
            </button>
          ))}
        </nav>
        <div className="panel">
          {tab === 'synthese' && <SummaryPanel {...props} />}
          {tab === 'parcours' && <TrackPanel {...props} />}
          {tab === 'suggestions' && <SuggestionsPanel {...props} />}
          {tab === 'points' && <PointsPanel {...props} />}
          {tab === 'equipes' && <TeamsPanel {...props} />}
          {tab === 'historique' && <HistoryPanel {...props} />}
        </div>
      </aside>
      {toast && <div className={'toast ' + toast.kind} role="status">{toast.text}</div>}
    </div>
  );
}
