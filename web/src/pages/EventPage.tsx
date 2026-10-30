import { useCallback, useEffect, useMemo, useState } from 'react';
import { toMapIncidents, type MapIncident } from '../components/incidentMarkers';
import { INCIDENT_CATEGORY, type FieldIncident } from '../components/FieldView';
import { Route } from '../../../server/src/geo/route';
import { ApiError, api } from '../api';
import { MapView, type MemberPosition, type PointEdit, type Selection } from '../components/MapView';
import { MapMenu } from '../components/MapMenu';
import { useLive } from '../useLive';
import { CoordinationPanel } from './event/CoordinationPanel';
import { TeamSpace, type SpaceEvent, type SpaceMission, type SpaceTeam } from '../components/TeamSpace';
import { PointEditor } from '../components/PointEditor';
import { SuggestionPopup } from '../components/SuggestionPopup';
import { TeamLegend, visiblePoints } from '../components/TeamLegend';
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

type Tab = 'synthese' | 'coordination' | 'parcours' | 'suggestions' | 'points' | 'equipes' | 'mon_equipe' | 'historique';
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

interface MyTeams { event: SpaceEvent; teams: (SpaceTeam & { missions: SpaceMission[] })[] }

const TABS: [Tab, string][] = [
  ['synthese', 'Synthèse'], ['coordination', 'Coordination'], ['parcours', 'Parcours'], ['suggestions', 'Suggestions'], ['points', 'Points'], ['equipes', 'Équipes'], ['historique', 'Historique'],
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
  const [photoView, setPhotoView] = useState<{ position: Position; heading: number } | null>(null);
  const [basemap, setBasemap] = useState(readBasemapPref);
  // Point en cours d'ajout ou de modification sur la carte (valeurs non enregistrées).
  const [edit, setEdit] = useState<PointEdit | null>(null);
  const [focus, setFocus] = useState<{ position: Position; n: number } | null>(null);
  const closeEdit = useCallback(() => setEdit(null), []);
  // Équipes dont la personne connectée fait partie : onglet « Mon équipe », en plus de l'organisation.
  const [myTeams, setMyTeams] = useState<MyTeams | null>(null);
  useEffect(() => {
    if (!data) return;
    api.get<MyTeams>('/api/events/' + eventId + '/mes-equipes').then(setMyTeams, () => setMyTeams(null));
  }, [data, eventId]);
  // Nouveau point : propose le nom de la rue ou du croisement (OSM), sans écraser un nom saisi.
  const draftKey = edit?.kind === 'new' && edit.autoName ? edit.position.join() : null;
  useEffect(() => {
    if (!draftKey) return;
    const position = draftKey.split(',').map(Number) as Position;
    let cancelled = false;
    const same = (prev: PointEdit | null) => prev?.kind === 'new' && prev.autoName && prev.position.join() === draftKey;
    const t = setTimeout(() => {
      setEdit((prev) => (same(prev) ? { ...prev!, namePending: true } : prev));
      api.get<{ name: string | null }>('/api/events/' + eventId + '/nom-de-lieu?lon=' + position[0] + '&lat=' + position[1]).then((r) => {
        if (cancelled) return;
        setEdit((prev) => (same(prev) ? { ...prev!, name: r.name ?? prev!.name, namePending: false } : prev && { ...prev, namePending: false }));
      }, () => setEdit((prev) => prev && { ...prev, namePending: false }));
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
      setEdit((prev) => (prev?.namePending ? { ...prev, namePending: false } : prev));
    };
  }, [draftKey, eventId]);
  // Équipes dont les points sont masqués sur la carte (0 = points sans équipe).
  const [hiddenTeams, setHiddenTeams] = useState<Set<number>>(new Set());
  const [recenter, setRecenter] = useState(0);
  // Menu ouvert par un clic sur la carte, et bulle de la suggestion sélectionnée.
  const [menuAt, setMenuAt] = useState<Position | null>(null);
  const [suggestionPopup, setSuggestionPopup] = useState(false);
  // Suggestion glissée sur la carte : position proposée pour la valider ailleurs que sur le nœud OSM.
  const [suggestionMove, setSuggestionMove] = useState<{ id: number; position: Position } | null>(null);
  const closeMenu = useCallback(() => setMenuAt(null), []);
  const closeSuggestion = useCallback(() => { setSuggestionPopup(false); setSuggestionMove(null); }, []);
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

  // Direct : à chaque signal, on rafraîchit ce qui bouge le jour J (missions, points, synthèse) et le tableau de bord.
  const [liveTick, setLiveTick] = useState(0);
  const refreshLive = useCallback(async () => {
    const [points, teams, summary] = await Promise.all([
      api.get<MissionPoint[]>(base + '/points'), api.get<Team[]>(base + '/teams'), api.get<Summary>(base + '/summary'),
    ]);
    setData((d) => (d ? { ...d, points, teams, summary } : d));
    setLiveTick((n) => n + 1);
  }, [base]);
  // Positions partagées (organisation seulement, si le partage est autorisé) : rechargées au signal « positions ».
  const [members, setMembers] = useState<MemberPosition[]>([]);
  const showMembers = !!data && data.event.role === 'organisateur' && data.event.locationSharing;
  const loadMembers = useCallback(() => {
    if (!showMembers) { setMembers([]); return; }
    api.get<MemberPosition[]>(base + '/positions').then(setMembers, () => undefined);
  }, [base, showMembers]);
  useEffect(() => {
    loadMembers();
    const t = setInterval(loadMembers, 30_000);
    return () => clearInterval(t);
  }, [loadMembers]);
  // Incidents en cours (SOS compris) : affichés sur la carte, rechargés à chaque signal du direct.
  const [incidents, setIncidents] = useState<MapIncident[]>([]);
  const loadIncidents = useCallback(() => {
    api.get<FieldIncident[]>(base + '/incidents').then((l) => setIncidents(toMapIncidents(l, INCIDENT_CATEGORY)), () => undefined);
  }, [base]);
  useEffect(() => { loadIncidents(); }, [loadIncidents, liveTick]);
  const live = useLive(eventId, refreshLive, 30_000, loadMembers);

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
    setSuggestionMove(null);
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
    kind: 'new', position: p, type: 'autre', description: '', autoName: true,
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
    setPhotoView(null);
  };

  const editingPoint = edit?.kind === 'existing' ? data.points.find((p) => p.id === edit.id) ?? null : null;
  const editor = edit && canEdit ? (
    <PointEditor
      eventId={eventId}
      edit={edit}
      point={editingPoint}
      onChange={(next) => setEdit(next.name !== edit.name ? { ...next, autoName: false } : next)}
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
      teams={data.teams}
      onTeamsChanged={async (message) => {
        setToast({ kind: 'ok', text: message });
        await reload();
      }}
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
            position: suggestionMove?.id === selectedSuggestion.id ? suggestionMove.position : selectedSuggestion.position,
            content: (
              <SuggestionPopup
                key={selectedSuggestion.id}
                s={selectedSuggestion}
                moveTo={suggestionMove?.id === selectedSuggestion.id ? suggestionMove.position : null}
                onResetMove={() => setSuggestionMove(null)}
                canEdit={canEdit}
                onClose={closeSuggestion}
                onPhotos={() => openPhotos(selectedSuggestion.position)}
                onDetails={() => setTab('suggestions')}
                onDone={async (message, pointId, openEditor) => {
                  setToast({ kind: 'ok', text: message });
                  await reload();
                  setSuggestionPopup(false);
                  setSuggestionMove(null);
                  if (pointId) {
                    // La suggestion validée devient un point : on ouvre directement sa bulle de modification.
                    setSelection({ kind: 'point', id: pointId });
                    setTab('points');
                    // Validée à une position choisie sur la carte : le point est posé, sans rouvrir de bulle.
                    if (!openEditor) return;
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
          members={members}
          incidents={incidents}
          track={data.track}
          suggestions={visibleSuggestions}
          points={visiblePoints(data.points, hiddenTeams).concat(
            // Le point en cours d'édition reste affiché même si son équipe est masquée.
            edit?.kind === 'existing' && !visiblePoints(data.points, hiddenTeams).some((p) => p.id === edit.id)
              ? data.points.filter((p) => p.id === edit.id)
              : [],
          )}
          selection={selection}
          addMode={addMode && canEdit}
          onSelect={select}
          onMapClick={mapClick}
          onSuggestionDrop={(id, p) => { select({ kind: 'suggestion', id }); setSuggestionMove({ id, position: p }); }}
          ghost={suggestionMove && suggestionPopup ? suggestionMove.position : null}
          onEditMove={(p) => setEdit((prev) => (prev ? { ...prev, position: p } : prev))}
          edit={canEdit ? edit : null}
          canEdit={canEdit}
          popup={popup}
          onBasemapError={(text) => setToast({ kind: 'error', text })}
          focus={focus}
          recenter={recenter}
          basemap={basemap}
          panoramax={{ enabled: panoramax, tilesUrl: PANORAMAX_API + '/map/{z}/{x}/{y}.mvt', clicked: inspectAt, photo: photoView ? null : photoAt, view: photoView }}
        />
        <div className="map-toolbar">
          {canEdit && (
            <button className={addMode ? 'primary' : ''} onClick={toggleAddMode} aria-pressed={addMode}>
              {addMode ? 'Terminer l’ajout' : '+ Ajouter des points'}
            </button>
          )}
          {data.track && <button onClick={() => setRecenter((n) => n + 1)} title="Recentrer la carte sur le parcours">⤢ Parcours</button>}
          <label className="check"><input type="checkbox" checked={showDismissed} onChange={(e) => setShowDismissed(e.target.checked)} /> Afficher les suggestions écartées</label>
          <select className="basemap" value={basemap} onChange={(e) => chooseBasemap(e.target.value)} aria-label="Fond de carte">
            {BASEMAPS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
          <label className="check" title="Rues couvertes par des photos Panoramax (à partir du zoom 13)"><input type="checkbox" checked={panoramax} onChange={(e) => togglePanoramax(e.target.checked)} /> Couverture photos</label>
        </div>
        {inspectAt && (
          <PanoramaxPanel position={inspectAt} onPicture={(p) => setPhotoAt(p?.position ?? null)} onView={setPhotoView} onClose={() => { setInspectAt(null); setPhotoAt(null); setPhotoView(null); }} />
        )}
        <TeamLegend
          teams={data.teams}
          points={data.points}
          hidden={hiddenTeams}
          onToggle={(id) => setHiddenTeams((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })}
        />
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
          <a className="small live-link" href={'#/direct/' + eventId} title="Suivi du jour J, adapté au téléphone">📱 Coordination en direct</a>
          <span className={'sync ' + (live.connected ? 'on' : 'off')} title={live.connected ? 'Mises à jour en direct' : 'Direct indisponible : rechargement régulier'}>{live.connected ? '● direct' : '○ hors direct'}</span>
        </div>
        <nav className="tabs" role="tablist">
          {(myTeams?.teams.length ? [...TABS.slice(0, 6), ['mon_equipe', myTeams.teams.length > 1 ? 'Mes équipes' : 'Mon équipe'] as [Tab, string], ...TABS.slice(6)] : TABS).map(([id, label]) => (
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
          {tab === 'coordination' && <CoordinationPanel event={data.event} canEdit={canEdit} liveTick={liveTick} members={showMembers ? members : null} />}
          {tab === 'mon_equipe' && myTeams && (
            <div className="stack" data-testid="mon-equipe">
              {myTeams.teams.length === 0 && <p className="muted">Vous ne faites plus partie d’aucune équipe.</p>}
              {myTeams.teams.map((t) => (
                <div key={t.id} className="stack">
                  <h2><span className="dot" style={{ background: t.color }} /> {t.name}{t.role === 'responsable' ? ' (responsable)' : ''}</h2>
                  <a className="button primary" href={'#/terrain/' + t.id}>Ouvrir la vue terrain (téléphone)</a>
                  <TeamSpace event={myTeams.event} team={t} missions={t.missions} />
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
      {toast && <div className={'toast ' + toast.kind} role="status">{toast.text}</div>}
    </div>
  );
}
