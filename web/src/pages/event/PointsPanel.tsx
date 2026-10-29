import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api';
import { teamColors } from '../../components/MapView';
import { POINT_TYPES as TYPES } from '../../components/PointEditor';
import { MISSION_STATUS, POINT_STATUS, SUGGESTION_TYPES, coords, dateTime, km } from '../../labels';
import type { HistoryEntry, MissionPoint } from '../../types';
import type { PanelProps } from '../EventPage';

const ORIGIN: Record<string, string> = { suggestion: 'suggestion OSM', manuel: 'création manuelle', import: 'import externe' };

export function PointsPanel({ data, canEdit, selection, select, startDraft }: PanelProps) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [origin, setOrigin] = useState('');
  const term = q.trim().toLowerCase();
  const list = data.points.filter(
    (p) => (!term || p.name.toLowerCase().includes(term) || p.description.toLowerCase().includes(term)) &&
      (!status || p.status === status) && (!type || p.type === type) && (!origin || p.origin === origin),
  );
  const current = selection?.kind === 'point' ? data.points.find((p) => p.id === selection.id) : undefined;

  return (
    <div className="stack">
      {canEdit && <AddByCoordinates startDraft={startDraft} />}
      <div className="filters">
        <input type="search" placeholder="Rechercher un point" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Statut">
          <option value="">Tous statuts</option>
          {Object.entries(POINT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
          <option value="">Tous types</option>
          {TYPES.map((k) => <option key={k} value={k}>{SUGGESTION_TYPES[k]}</option>)}
        </select>
        <select value={origin} onChange={(e) => setOrigin(e.target.value)} aria-label="Origine">
          <option value="">Toutes origines</option>
          {Object.entries(ORIGIN).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {current && <PointDetail p={current} canEdit={canEdit} />}
      <ul className="items">
        {list.map((p) => (
          <li key={p.id} className={current?.id === p.id ? 'selected' : ''} onClick={() => select({ kind: 'point', id: p.id })}>
            <span className="dot" style={{ background: teamColors(p.missions.map((m) => m.color)) }} />
            <span className="grow">
              <b>{p.name}</b><br />
              <span className="muted">{km(p.distance)} · {POINT_STATUS[p.status]}{p.missions.length ? ' · ' + p.missions.map((m) => m.teamName).join(', ') : ''}</span>
            </span>
          </li>
        ))}
        {list.length === 0 && <li className="muted">Aucun point. Validez des suggestions ou ajoutez des points sur la carte.</li>}
      </ul>
    </div>
  );
}

function AddByCoordinates({ startDraft }: { startDraft: PanelProps['startDraft'] }) {
  const [open, setOpen] = useState(false);
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    startDraft([Number(lon), Number(lat)]);
    setLat('');
    setLon('');
    setOpen(false);
  };
  if (!open) return <button onClick={() => setOpen(true)}>+ Placer un point par coordonnées</button>;
  return (
    <form className="card stack" onSubmit={submit}>
      <div className="row">
        <label>Latitude<input inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value.replace(',', '.'))} required pattern="-?\d+(\.\d+)?" /></label>
        <label>Longitude<input inputMode="decimal" value={lon} onChange={(e) => setLon(e.target.value.replace(',', '.'))} required pattern="-?\d+(\.\d+)?" /></label>
      </div>
      <p className="muted">Le point apparaît sur la carte, où vous complétez sa fiche.</p>
      <div className="row"><button className="primary">Placer sur la carte</button><button type="button" onClick={() => setOpen(false)}>Fermer</button></div>
    </form>
  );
}

/** Fiche en lecture : la modification se fait sur la carte, dans la bulle du point. */
function PointDetail({ p, canEdit }: { p: MissionPoint; canEdit: boolean }) {
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  useEffect(() => { setHistory(null); }, [p.id]);
  return (
    <div className="card detail">
      <h3>{p.name} <span className="muted">#{p.id}</span></h3>
      <p className="muted">
        {SUGGESTION_TYPES[p.type] ?? p.type} · origine : {ORIGIN[p.origin]} · {POINT_STATUS[p.status]}<br />
        {coords(p.position)} · {km(p.distance)}{p.distanceLocked ? ' (fixée)' : ''}
      </p>
      {p.description && <p className="pre">{p.description}</p>}
      {p.missions.length > 0 && (
        <ul className="plain">{p.missions.map((m) => <li key={m.missionId}><span className="dot" style={{ background: m.color }} /> {m.teamName} — mission n° {m.position}, {MISSION_STATUS[m.status]}</li>)}</ul>
      )}
      {canEdit && <p className="muted">Modifier, déplacer ou supprimer : dans la bulle du point, sur la carte.</p>}
      <details onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && !history) void api.get<HistoryEntry[]>('/api/points/' + p.id + '/history').then(setHistory); }}>
        <summary>Historique</summary>
        {history ? <ul className="history">{history.map((h) => <li key={h.id}><span className="muted">{dateTime(h.at)}</span> {h.entity === 'mission' ? 'mission : ' : ''}{h.action.replace(/_/g, ' ')} {h.actor ? '(' + h.actor + ')' : ''}</li>)}</ul> : <p>Chargement…</p>}
      </details>
    </div>
  );
}
