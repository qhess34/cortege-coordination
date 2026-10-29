// Roadbook imprimable (manifestation complète ou une équipe). « Imprimer » permet aussi d'enregistrer en PDF.
import { useEffect, useMemo, useState } from 'react';
import { ApiError, api } from '../api';
import { DEFAULT_BASEMAP } from '../basemaps';
import { renderSnapshots, type SnapshotPoint, type SnapshotView } from '../components/mapSnapshots';
import { SUGGESTION_TYPES, coords, dateTime, fieldDescription, km } from '../labels';
import type { Position } from '../types';
import { groupItems, type Group, type Item, type RbPoint } from './roadbookGroups';

interface RbTeam {
  id: number; name: string; color: string; description: string; instructions: string; leaderName: string | null;
  missions: { order: number; status: string; instructions: string; point: RbPoint }[];
}
interface Roadbook {
  generatedAt: string;
  scope: 'manifestation' | 'equipe';
  event: { id: number; name: string; description: string; startsAt: string | null; endsAt: string | null; areaName: string; instructions: string };
  track: { name: string | null; version: number; length: number; closed: boolean; geometry: { coordinates: Position[][] }; waypoints: { name: string | null; position: Position; distance: number | null }[] } | null;
  teams: RbTeam[];
  unassigned: RbPoint[];
}

function readBasemap(): string {
  try {
    return localStorage.getItem('cortege.fond') ?? DEFAULT_BASEMAP;
  } catch {
    return DEFAULT_BASEMAP;
  }
}

const FLOW_SHORT: Record<string, string> = { entrant: 'sens unique vers le cortège', sortant: 'sens unique depuis le cortège', double_sens: 'double sens', variable: 'sens variable' };

export function RoadbookPage({ eventId, teamId }: { eventId: number; teamId: number | null }) {
  const [rb, setRb] = useState<Roadbook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const query = teamId ? '?team=' + teamId : '';

  useEffect(() => {
    api.get<Roadbook>('/api/events/' + eventId + '/roadbook' + query).then(setRb, (e) => setError(e instanceof ApiError ? e.message : 'Chargement impossible.'));
  }, [eventId, query]);

  // Lieux de chaque section (équipes, puis points sans équipe).
  const sections = useMemo(() => {
    if (!rb) return null;
    return {
      teams: rb.teams.map((t) => ({
        team: t,
        groups: groupItems(t.missions.map((m) => ({ point: m.point, order: m.order, instructions: m.instructions })), 't' + t.id),
      })),
      unassigned: groupItems(rb.unassigned.map((p) => ({ point: p })), 'u'),
    };
  }, [rb]);

  // Cartes : vue d'ensemble, puis une vue par lieu (ses points mis en évidence et numérotés).
  const plan = useMemo(() => {
    if (!rb || !sections) return null;
    const points: SnapshotPoint[] = [];
    const all: Position[] = [];
    for (const t of rb.teams) for (const m of t.missions) {
      points.push({ id: 'p' + m.point.id, position: m.point.position, color: t.color, label: m.point.name });
      all.push(m.point.position);
    }
    for (const p of rb.unassigned) { points.push({ id: 'p' + p.id, position: p.position, color: '#495057', label: p.name }); all.push(p.position); }
    for (const seg of rb.track?.geometry.coordinates ?? []) all.push(...seg);
    const views: SnapshotView[] = [];
    if (all.length) {
      const xs = all.map((p) => p[0]);
      const ys = all.map((p) => p[1]);
      views.push({
        key: 'ensemble',
        bounds: [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]],
        // Roadbook d'équipe : numéros des missions sur la vue d'ensemble.
        labels: rb.scope === 'equipe' ? rb.teams[0]?.missions.map((m) => ({ position: m.point.position, text: String(m.order) })) : undefined,
      });
    }
    for (const g of [...sections.teams.flatMap((t) => t.groups), ...sections.unassigned]) {
      const pos = g.items.map((i) => i.point.position);
      const xs = pos.map((p) => p[0]);
      const ys = pos.map((p) => p[1]);
      views.push({
        key: g.key,
        ...(g.items.length === 1
          ? { center: pos[0]!, zoom: 19 }
          : { bounds: [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]] as [Position, Position], maxZoom: 19 }),
        highlight: g.items.map((i) => 'p' + i.point.id),
        labels: g.items.filter((i) => i.order !== undefined).map((i) => ({ position: i.point.position, text: String(i.order) })),
      });
    }
    return { points, views };
  }, [rb, sections]);

  useEffect(() => {
    if (!rb || !plan || !plan.views.length) return;
    const ctrl = new AbortController();
    setProgress({ done: 0, total: plan.views.length });
    void renderSnapshots({
      width: 900, height: 520, basemapId: readBasemap(), track: rb.track?.geometry.coordinates ?? null,
      points: plan.points, views: plan.views, signal: ctrl.signal,
      onImage: (key, url) => {
        setImages((prev) => ({ ...prev, [key]: url }));
        setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
      },
    }).catch(() => setProgress(null));
    return () => ctrl.abort();
  }, [rb, plan]);

  if (error) return <main className="page"><p className="error">{error}</p></main>;
  if (!rb) return <main className="page"><p>Préparation du roadbook…</p></main>;
  const team = rb.scope === 'equipe' ? rb.teams[0] : null;
  const title = 'Roadbook — ' + rb.event.name + (team ? ' — ' + team.name : '');
  const mapsReady = !progress || progress.done >= progress.total;

  return (
    <main className="page roadbook" data-testid="roadbook">
      <div className="roadbook-actions no-print">
        <a href={'#/evenements/' + eventId}>← Retour à la carte</a>
        <span className="spacer" />
        {progress && !mapsReady && <span className="muted" role="status">Préparation des cartes… {progress.done}/{progress.total}</span>}
        <a className="button" href={'/api/events/' + eventId + '/roadbook.gpx' + query} download>Télécharger le GPX</a>
        <button className="primary" onClick={() => window.print()}>Imprimer / PDF</button>
      </div>

      <section className="rb-cover">
        <h1>{title}</h1>
        <dl className="kv">
          <dt>Début</dt><dd>{dateTime(rb.event.startsAt)}</dd>
          <dt>Fin</dt><dd>{dateTime(rb.event.endsAt)}</dd>
          {rb.event.areaName && <><dt>Zone</dt><dd>{rb.event.areaName}</dd></>}
          {rb.track && <><dt>Parcours</dt><dd>{km(rb.track.length)}{rb.track.closed ? ' (boucle)' : ''} — version {rb.track.version}</dd></>}
          <dt>Édité le</dt><dd>{dateTime(rb.generatedAt)}</dd>
        </dl>
        <p className="rb-warning">
          Document de coordination. Les points sont issus de la préparation de l’organisateur et, pour certains, de
          données OpenStreetMap à vérifier sur place. Ils ne valent pas autorisation de fermer une voie et ne
          remplacent ni les consignes des autorités ni les services d’urgence.
        </p>
        {rb.event.instructions && <><h2>Consignes générales</h2><p className="pre">{rb.event.instructions}</p></>}
        {rb.event.description && <p className="pre muted">{rb.event.description}</p>}
        <MapImage src={images.ensemble} alt="Vue d’ensemble du parcours" large />
        {rb.track && rb.track.waypoints.length > 0 && (
          <><h2>Points de passage</h2>
            <ul className="plain">{rb.track.waypoints.map((w, i) => <li key={i}>{km(w.distance)} — {w.name ?? 'Sans nom'}</li>)}</ul></>
        )}
        {!team && rb.teams.length > 0 && (
          <><h2>Équipes</h2>
            <ul className="plain">{rb.teams.map((t) => <li key={t.id}><span className="dot" style={{ background: t.color }} /> {t.name} — {t.missions.length} mission(s){t.leaderName ? ', responsable : ' + t.leaderName : ''}</li>)}</ul></>
        )}
      </section>

      {sections?.teams.map(({ team: t, groups }) => <TeamSection key={t.id} team={t} groups={groups} images={images} />)}

      {rb.unassigned.length > 0 && (
        <section className="rb-team">
          <h2>Points sans équipe ({rb.unassigned.length})</h2>
          <p className="rb-warning">Ces points ne sont affectés à aucune équipe active.</p>
          {sections?.unassigned.map((g) => <GroupCard key={g.key} group={g} images={images} />)}
        </section>
      )}
      {rb.teams.length === 0 && rb.unassigned.length === 0 && <p className="muted">Aucun point de mission pour l’instant.</p>}

      <footer className="rb-footer muted">Fonds de carte et données : © contributeurs OpenStreetMap{readBasemap().includes('ign') ? ', © IGN' : ''}.</footer>
    </main>
  );
}

function TeamSection({ team: t, groups, images }: { team: RbTeam; groups: Group[]; images: Record<string, string> }) {
  return (
    <section className="rb-team">
      <h2><span className="rb-color" style={{ background: t.color }} /> Équipe {t.name}</h2>
      <dl className="kv">
        <dt>Responsable</dt><dd>{t.leaderName ?? 'non désigné'}</dd>
        {t.description && <><dt>Description</dt><dd>{t.description}</dd></>}
      </dl>
      {t.instructions && <><h3>Consignes de l’équipe</h3><p className="pre">{t.instructions}</p></>}
      {t.missions.length === 0 ? <p className="muted">Aucune mission.</p> : (
        <>
          <table className="table rb-table">
            <thead><tr><th>N°</th><th>Point</th><th>Type</th><th>Parcours</th><th>Coordonnées</th></tr></thead>
            <tbody>
              {t.missions.map((m) => (
                <tr key={m.point.id}>
                  <td>{m.order}</td><td>{m.point.name}</td><td>{SUGGESTION_TYPES[m.point.type] ?? m.point.type}</td>
                  <td>{km(m.point.distance)}</td><td>{coords(m.point.position)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {groups.map((g) => <GroupCard key={g.key} group={g} images={images} />)}
        </>
      )}
    </section>
  );
}

/** Fiche d'un lieu : un point seul, ou plusieurs points proches (ex. accès d'un même carrefour) et une seule carte. */
function GroupCard({ group, images }: { group: Group; images: Record<string, string> }) {
  const single = group.items.length === 1 ? group.items[0]! : null;
  const orders = group.items.map((i) => i.order).filter((o): o is number => o !== undefined);
  return (
    <article className="rb-point" data-testid="rb-lieu">
      <h3>
        {single
          ? (single.order !== undefined ? single.order + '. ' : '') + single.point.name
          : 'Lieu : ' + group.title + (orders.length ? ' — points ' + orders.join(', ') : ' — ' + group.items.length + ' points')}
      </h3>
      <div className="rb-point-body">
        <div>{group.items.map((it) => <PointDetails key={it.point.id} item={it} titled={!single} />)}</div>
        <MapImage src={images[group.key]} alt={'Carte : ' + group.title} />
        <div className="rb-notes">Notes :</div>
      </div>
    </article>
  );
}

function PointDetails({ item, titled }: { item: Item; titled: boolean }) {
  const p = item.point;
  return (
    <div className={titled ? 'rb-subpoint' : undefined}>
      {titled && <h4>{item.order !== undefined ? item.order + '. ' : ''}{p.name}</h4>}
      <dl className="kv">
        <dt>Type</dt><dd>{SUGGESTION_TYPES[p.type] ?? p.type}</dd>
        <dt>Parcours</dt><dd>{km(p.distance)}</dd>
        <dt>Coordonnées</dt><dd>{coords(p.position)}</dd>
        {!titled && p.osm && p.osm.routeNames.length > 0 && <><dt>Voie du cortège</dt><dd>{p.osm.routeNames.join(', ')}</dd></>}
      </dl>
      {fieldDescription(p.description) && <p className="pre">{fieldDescription(p.description)}</p>}
      {item.instructions && <p className="pre"><b>Consignes :</b> {item.instructions}</p>}
      {p.osm && p.osm.branches.length > 0 && (
        <p>
          <b>Voie d’accès :</b>{' '}
          {p.osm.branches.map((b) => (b.name ?? 'voie sans nom') + (b.motor === 'non' ? ' (piétons, vélos)' : ' — ' + FLOW_SHORT[b.flow])).join(' ; ')}
        </p>
      )}
    </div>
  );
}

function MapImage({ src, alt, large }: { src?: string; alt: string; large?: boolean }) {
  return src
    ? <img className={'rb-map' + (large ? ' large' : '')} src={src} alt={alt} />
    : <div className={'rb-map placeholder' + (large ? ' large' : '')}>Carte en préparation…</div>;
}
