import { useCallback, useEffect, useMemo, useState } from 'react';
import { Route } from '../../../server/src/geo/route';
import { ApiError, api } from '../api';
import { MapView, type PointEdit, type Selection } from '../components/MapView';
import { MapMenu } from '../components/MapMenu';
import { PointEditor } from '../components/PointEditor';
import { SuggestionPopup } from '../components/SuggestionPopup';
import { PanoramaxPanel } from '../components/PanoramaxPanel';
import { BASEMAPS, DEFAULT_BASEMAP } from '../basemaps';
import { PANORAMAX_API } from '../panoramax';
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
  /** Ouvre la bulle de création d'un point à cette position, sur la carte. */
  startDraft: (p: Position) => void;
}

type Tab = 'synthese' | 'parcours' | 'suggestions' | 'points' | 'equipes' | 'historique';
/** Préférence locale (simple confort d'affichage) : couverture des photos Panoramax sur la carte. */
const PNX_PREF = 'cortege.panoramax';
function readPanoramaxPref(): boolean {
  try {
    return localStorage.getItem(PNX_PREF) !== 'non';
  } catch {
    return true;
  }
}

const BASEMAP_PREF = 'cortege.fond';
function readBasemapPref(): string {
  try {
    return localStorage.getItem(BASEMAP_PREF) ?? DEFAULT_BASEMAP;
  } catch {
    return DEFAULT_BASEMAP;
  }
}

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
  const [panoramax, setPanoramax] = useState(readPanoramaxPref);
  const [inspectAt, setInspectAt] = useState<Position | null>(null);
  const [photoAt, setPhotoAt] = useState<Position | null>(null);
  const [basemap, setBasemap] = useState(readBasemapPref);
  // Point en cours d'ajout ou de modification sur la carte (valeurs non enregistrées).
  const [edit, setEdit] = useState<PointEdit | null>(null);
  const [focus, setFocus] = useState<{ position: Position; n: number } | null>(null);
  const closeEdit = useCallback(() => setEdit(null), []);
  // Menu ouvert par un clic sur la carte, et bulle de la suggestion sélectionnée.
  const [menuAt, setMenuAt] = useState<Position | null>(null);
  const [suggestionPopup, setSuggestionPopup] = useState(false);
  const closeMenu = useCallback(() => setMenuAt(null), []);
  const closeSuggestion = useCallback(() => setSuggestionPopup(false), []);
  const route = useMemo(() => (data?.track ? new Route(data.track.geometry.coordinates) : null), [data?.track]);
  const chooseBasemap = (id: string) => {
    setBasemap(id);
    try { localStorage.setItem(BASEMAP_PREF, id); } catch { /* stockage indisponible : préférence non mémorisée */ }
  };
  const togglePanoramax = (on: boolean) => {
    setPanoramax(on);
    try { localStorage.setItem(PNX_PREF, on ? 'oui' : 'non'); } catch { /* stockage indisponible : préférence non mémorisée */ }
  };

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

  // Sélectionner un point (sur la carte ou dans la liste) ouvre sa bulle d'édition sur la carte.
  const select = (s: Selection) => {
    setSelection(s);
    setMenuAt(null);
    setSuggestionPopup(s?.kind === 'suggestion');
    if (s?.kind === 'suggestion') setTab('suggestions');
    if (s?.kind === 'point') setTab('points');
    const p = s?.kind === 'point' ? data.points.find((x) => x.id === s.id) : undefined;
    if (p && canEdit) {
      setEdit({ kind: 'existing', id: p.id, version: p.version, position: p.position, name: p.name, type: p.type, description: p.description });
    } else {
      setEdit(null);
    }
  };

  const newDraft = (p: Position): PointEdit => ({
    kind: 'new', position: p, type: 'autre', description: '',
    name: 'Point ' + (data.points.filter((x) => x.origin === 'manuel').length + 1),
  });

  // Mode ajout : un clic place le point provisoire (ou le déplace s'il existe déjà) ; il n'est créé qu'à
  // la validation de sa bulle. Le mode reste actif pour enchaîner plusieurs points.
  const placeDraft = (p: Position) => {
    setSelection(null);
    setMenuAt(null);
    setEdit((prev) => (prev?.kind === 'new' ? { ...prev, position: p } : newDraft(p)));
  };

  const startDraft = (p: Position) => {
    setSelection(null);
    setMenuAt(null);
    setEdit(newDraft(p));
    setFocus((f) => ({ position: p, n: (f?.n ?? 0) + 1 }));
  };

  const toggleAddMode = () => {
    if (addMode && edit?.kind === 'new') setEdit(null);
    setAddMode(!addMode);
  };

  // Clic sur la carte hors point et suggestion : menu (photos, ajout d'un point…) ; en mode ajout, point provisoire.
  const mapClick = (p: Position) => {
    if (addMode && canEdit) return placeDraft(p);
    setSelection(null);
    setEdit(null);
    setSuggestionPopup(false);
    setMenuAt(p);
  };

  const openPhotos = (p: Position) => {
    setInspectAt(p);
    setPhotoAt(null);
  };

  const editingPoint = edit?.kind === 'existing' ? data.points.find((p) => p.id === edit.id) ?? null : null;
  const editor = edit && canEdit ? (
    <PointEditor
      eventId={eventId}
      edit={edit}
      point={editingPoint}
      onChange={setEdit}
      onClose={closeEdit}
      onSaved={async (id, message) => {
        setEdit(null);
        setSelection({ kind: 'point', id });
        setToast({ kind: 'ok', text: message });
        await reload();
      }}
      onDeleted={async () => {
        setEdit(null);
        setSelection(null);
        setToast({ kind: 'ok', text: 'Point supprimé.' });
        await reload();
      }}
      onPhotos={() => openPhotos(edit.position)}
    />
  ) : null;

  const selectedSuggestion = selection?.kind === 'suggestion' ? data.suggestions.find((x) => x.id === selection.id) : undefined;
  const onRoute = menuAt && route ? route.locate(menuAt) : null;
  const popup = editor && edit
    ? { key: 'point:' + edit.kind + ':' + (edit.id ?? 'nouveau'), position: edit.position, content: editor }
    : menuAt
      ? {
          key: 'menu:' + menuAt.join(','),
          position: menuAt,
          content: (
            <MapMenu
              position={menuAt}
              onRoute={onRoute ? { distance: onRoute.distance, offset: onRoute.offset } : null}
              canEdit={canEdit}
              onClose={closeMenu}
              onPhotos={() => { openPhotos(menuAt); setMenuAt(null); }}
              onAddPoint={() => { setMenuAt(null); setEdit(newDraft(menuAt)); }}
            />
          ),
        }
      : selectedSuggestion && suggestionPopup
        ? {
            key: 'suggestion:' + selectedSuggestion.id,
            position: selectedSuggestion.position,
            content: (
              <SuggestionPopup
                key={selectedSuggestion.id}
                s={selectedSuggestion}
                canEdit={canEdit}
                onClose={closeSuggestion}
                onPhotos={() => openPhotos(selectedSuggestion.position)}
                onDetails={() => setTab('suggestions')}
                onDone={async (message, pointId) => {
                  setToast({ kind: 'ok', text: message });
                  await reload();
                  setSuggestionPopup(false);
                  if (pointId) {
                    // La suggestion validée devient un point : on ouvre directement sa bulle de modification.
                    setSelection({ kind: 'point', id: pointId });
                    setTab('points');
                    const pts = await api.get<MissionPoint[]>(base + '/points');
                    const p = pts.find((x) => x.id === pointId);
                    if (p) setEdit({ kind: 'existing', id: p.id, version: p.version, position: p.position, name: p.name, type: p.type, description: p.description });
                  } else {
                    setSelection(null);
                  }
                }}
              />
            ),
          }
        : null;

  const props: PanelProps = { data, canEdit, reload, run, selection, select, startDraft };
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
          onMapClick={mapClick}
          onEditMove={(p) => setEdit((prev) => (prev ? { ...prev, position: p } : prev))}
          edit={canEdit ? edit : null}
          popup={popup}
          onBasemapError={(text) => setToast({ kind: 'error', text })}
          focus={focus}
          basemap={basemap}
          panoramax={{ enabled: panoramax, tilesUrl: PANORAMAX_API + '/map/{z}/{x}/{y}.mvt', clicked: inspectAt, photo: photoAt }}
        />
        <div className="map-toolbar">
          {canEdit && (
            <button className={addMode ? 'primary' : ''} onClick={toggleAddMode} aria-pressed={addMode}>
              {addMode ? 'Terminer l’ajout' : '+ Ajouter des points'}
            </button>
          )}
          <label className="check"><input type="checkbox" checked={showDismissed} onChange={(e) => setShowDismissed(e.target.checked)} /> Afficher les suggestions écartées</label>
          <select className="basemap" value={basemap} onChange={(e) => chooseBasemap(e.target.value)} aria-label="Fond de carte">
            {BASEMAPS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
          <label className="check" title="Rues couvertes par des photos Panoramax (à partir du zoom 13)"><input type="checkbox" checked={panoramax} onChange={(e) => togglePanoramax(e.target.checked)} /> Couverture photos</label>
        </div>
        {inspectAt && (
          <PanoramaxPanel position={inspectAt} onPicture={(p) => setPhotoAt(p?.position ?? null)} onClose={() => { setInspectAt(null); setPhotoAt(null); }} />
        )}
        {addMode && <div className="map-hint">Cliquez sur la carte pour placer un point, complétez sa fiche puis « Ajouter ». Recommencez pour le suivant.</div>}
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
