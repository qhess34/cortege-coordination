import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../api';
import { MISSION_STATUS, POINT_STATUS, SUGGESTION_TYPES, coords, dateTime, km } from '../../labels';
import type { HistoryEntry, MissionPoint } from '../../types';
import type { PanelProps } from '../EventPage';

const TYPES = ['carrefour', 'rue_laterale', 'acces_vehicule_entrant', 'acces_pieton_cycle', 'voie_privee', 'verification', 'point_fixe', 'autre'];
const ORIGIN: Record<string, string> = { suggestion: 'suggestion OSM', manuel: 'création manuelle', import: 'import externe' };

export function PointsPanel({ data, canEdit, run, selection, select }: PanelProps) {
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
      {canEdit && <AddByCoordinates eventId={data.event.id} run={run} select={select} />}
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
      {current && <PointDetail key={current.id + ':' + current.version} p={current} canEdit={canEdit} run={run} select={select} />}
      <ul className="items">
        {list.map((p) => (
          <li key={p.id} className={current?.id === p.id ? 'selected' : ''} onClick={() => select({ kind: 'point', id: p.id })}>
            <span className="dot" style={{ background: p.missions[0]?.color ?? '#495057' }} />
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

function AddByCoordinates({ eventId, run, select }: { eventId: number; run: PanelProps['run']; select: PanelProps['select'] }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await run(async () => {
      const p = await api.post<MissionPoint>('/api/events/' + eventId + '/points', { name, position: [Number(lon), Number(lat)], type: 'autre' });
      select({ kind: 'point', id: p.id });
    }, 'Point ajouté.');
    if (ok) { setName(''); setLat(''); setLon(''); }
  };
  if (!open) return <button onClick={() => setOpen(true)}>+ Ajouter un point par coordonnées</button>;
  return (
    <form className="card stack" onSubmit={submit}>
      <label>Nom<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
      <div className="row">
        <label>Latitude<input inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value.replace(',', '.'))} required pattern="-?\d+(\.\d+)?" /></label>
        <label>Longitude<input inputMode="decimal" value={lon} onChange={(e) => setLon(e.target.value.replace(',', '.'))} required pattern="-?\d+(\.\d+)?" /></label>
      </div>
      <div className="row"><button className="primary">Ajouter</button><button type="button" onClick={() => setOpen(false)}>Fermer</button></div>
    </form>
  );
}

function PointDetail({ p, canEdit, run, select }: { p: MissionPoint; canEdit: boolean; run: PanelProps['run']; select: PanelProps['select'] }) {
  const [form, setForm] = useState({
    name: p.name, description: p.description, type: p.type, lat: String(p.position[1]), lon: String(p.position[0]),
    distance: p.distance === null ? '' : String(Math.round(p.distance)),
  });
  const [confirmDelete, setConfirmDelete] = useState<{ missions: { team: string; status: string }[] } | null>(null);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  useEffect(() => { setHistory(null); }, [p.id]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = { version: p.version, name: form.name, description: form.description, type: form.type };
    const lat = Number(form.lat), lon = Number(form.lon);
    if (lat !== p.position[1] || lon !== p.position[0]) body.position = [lon, lat];
    const d = form.distance === '' ? null : Number(form.distance);
    if (d !== null && (p.distance === null || Math.round(p.distance) !== d)) body.distance = d;
    if (d === null && p.distanceLocked) body.distance = null;
    await run(() => api.patch('/api/points/' + p.id, body), 'Point enregistré.');
  };

  const remove = async (confirmed: boolean) => {
    try {
      await api.delete('/api/points/' + p.id + (confirmed ? '?confirm=1' : ''));
      select(null);
      await run(async () => undefined, 'Point supprimé.');
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.details) setConfirmDelete(e.details as { missions: { team: string; status: string }[] });
      else await run(() => Promise.reject(e));
    }
  };

  return (
    <div className="card detail">
      <h3>{p.name} <span className="muted">#{p.id}</span></h3>
      <p className="muted">Origine : {ORIGIN[p.origin]} · {POINT_STATUS[p.status]} · {coords(p.position)}</p>
      {p.missions.length > 0 && (
        <ul className="plain">{p.missions.map((m) => <li key={m.missionId}><span className="dot" style={{ background: m.color }} /> {m.teamName} — mission n° {m.position}, {MISSION_STATUS[m.status]}</li>)}</ul>
      )}
      {canEdit ? (
        <form className="stack" onSubmit={save}>
          <label>Nom<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={200} /></label>
          <label>Type
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {TYPES.map((k) => <option key={k} value={k}>{SUGGESTION_TYPES[k]}</option>)}
            </select>
          </label>
          <label>Description<textarea rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          <div className="row">
            <label>Latitude<input value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value.replace(',', '.') })} /></label>
            <label>Longitude<input value={form.lon} onChange={(e) => setForm({ ...form, lon: e.target.value.replace(',', '.') })} /></label>
          </div>
          <label>Distance cumulée (m){p.distanceLocked ? ' — fixée manuellement (videz pour recalculer)' : ' — calculée'}
            <input inputMode="numeric" value={form.distance} onChange={(e) => setForm({ ...form, distance: e.target.value })} />
          </label>
          <p className="muted">Astuce : le point sélectionné peut aussi être glissé sur la carte.</p>
          <div className="row">
            <button className="primary">Enregistrer</button>
            <button type="button" className="danger" onClick={() => remove(false)}>Supprimer</button>
          </div>
        </form>
      ) : <p className="pre">{p.description}</p>}
      {confirmDelete && (
        <div className="warning">
          <b>Ce point est affecté :</b>
          <ul>{confirmDelete.missions.map((m, i) => <li key={i}>{m.team} ({MISSION_STATUS[m.status] ?? m.status})</li>)}</ul>
          La suppression annulera ces missions (elles restent dans l’historique){p.suggestionId ? ' et la suggestion d’origine sera écartée' : ''}.
          <div className="row">
            <button className="danger" onClick={() => remove(true)}>Confirmer la suppression</button>
            <button onClick={() => setConfirmDelete(null)}>Annuler</button>
          </div>
        </div>
      )}
      <details onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && !history) void api.get<HistoryEntry[]>('/api/points/' + p.id + '/history').then(setHistory); }}>
        <summary>Historique</summary>
        {history ? <ul className="history">{history.map((h) => <li key={h.id}><span className="muted">{dateTime(h.at)}</span> {h.entity === 'mission' ? 'mission : ' : ''}{h.action.replace(/_/g, ' ')} {h.actor ? '(' + h.actor + ')' : ''}</li>)}</ul> : <p>Chargement…</p>}
      </details>
    </div>
  );
}
