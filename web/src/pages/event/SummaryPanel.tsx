import { Fragment, useState, type FormEvent } from 'react';
import { ApiError, api } from '../../api';
import { notifyEventsChanged } from '../../components/EventSwitcher';
import { EVENT_STATUS, MISSION_STATUS, POINT_STATUS, SUGGESTION_STATUS, dateTime, km } from '../../labels';
import type { PanelProps } from '../EventPage';

const toLocal = (s: string | null) => (s ? new Date(new Date(s).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
const fromLocal = (s: string) => (s ? new Date(s).toISOString() : null);

export function SummaryPanel({ data, canEdit, run, select }: PanelProps) {
  const { event: ev, summary: s } = data;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: ev.name, description: ev.description, areaName: ev.areaName, status: ev.status, instructions: ev.instructions,
    startsAt: toLocal(ev.startsAt), endsAt: toLocal(ev.endsAt),
  });
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await run(
      () => api.patch('/api/events/' + ev.id, { ...form, startsAt: fromLocal(form.startsAt), endsAt: fromLocal(form.endsAt), version: ev.version }),
      'Événement enregistré.',
    );
    if (ok) {
      setEditing(false);
      notifyEventsChanged();
    }
  };
  const count = (m: Record<string, number>, k: string) => m[k] ?? 0;

  return (
    <div className="stack">
      {editing ? (
        <form className="stack" onSubmit={save}>
          <label>Nom<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
          <label>Description<textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          <div className="row">
            <label>Début<input type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} /></label>
            <label>Fin<input type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} /></label>
          </div>
          <label>Zone géographique<input value={form.areaName} onChange={(e) => setForm({ ...form, areaName: e.target.value })} /></label>
          <label>Statut
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as typeof form.status })}>
              {Object.entries(EVENT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label>Consignes générales<textarea rows={5} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} /></label>
          <div className="row"><button className="primary">Enregistrer</button><button type="button" onClick={() => setEditing(false)}>Annuler</button></div>
        </form>
      ) : (
        <div className="card">
          <dl className="kv">
            <dt>Statut</dt><dd>{EVENT_STATUS[ev.status]}</dd>
            <dt>Début</dt><dd>{dateTime(ev.startsAt)}</dd>
            <dt>Fin</dt><dd>{dateTime(ev.endsAt)}</dd>
            <dt>Zone</dt><dd>{ev.areaName || '—'}</dd>
          </dl>
          {ev.description && <p className="pre">{ev.description}</p>}
          {ev.instructions && <><h3>Consignes générales</h3><p className="pre">{ev.instructions}</p></>}
          {canEdit && <button onClick={() => setEditing(true)}>Modifier</button>}
        </div>
      )}

      <div className="grid-stats">
        <div className="stat"><b>{s.track ? km(s.track.length) : '—'}</b><span>Parcours{s.track ? ' (v' + s.track.version + ')' : ''}</span></div>
        <div className="stat"><b>{count(s.suggestions, 'a_examiner')}</b><span>Suggestions à examiner</span></div>
        <div className="stat"><b>{Object.values(s.points).reduce((a, b) => a + b, 0)}</b><span>Points de mission</span></div>
        <div className="stat"><b>{s.teams.active}</b><span>Équipes actives</span></div>
      </div>

      {!s.track && <p className="warning">Aucun parcours importé : commencez par l’onglet Parcours.</p>}
      {s.lastAnalysis?.outdated && <p className="warning">Le parcours a changé depuis la dernière analyse OSM : relancez-la (onglet Suggestions).</p>}

      <div className="card">
        <h3>Points validés sans équipe ({s.unassignedPoints.length})</h3>
        {s.unassignedPoints.length === 0 ? <p className="muted">{Object.keys(s.points).length ? 'Tous les points sont affectés.' : 'Aucun point de mission pour l’instant.'}</p> : (
          <ul className="plain">
            {s.unassignedPoints.map((p) => (
              <li key={p.id}><button className="link" onClick={() => select({ kind: 'point', id: p.id })}>{p.name}</button> <span className="muted">{km(p.distance)}</span></li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h3>Répartition</h3>
        <dl className="kv">
          {Object.entries(SUGGESTION_STATUS).map(([k, v]) => <Fragment key={'s' + k}><dt>Suggestions — {v}</dt><dd>{count(s.suggestions, k)}</dd></Fragment>)}
          {Object.entries(POINT_STATUS).map(([k, v]) => <Fragment key={'p' + k}><dt>Points — {v}</dt><dd>{count(s.points, k)}</dd></Fragment>)}
          {Object.entries(MISSION_STATUS).map(([k, v]) => count(s.missions, k) ? <Fragment key={'m' + k}><dt>Missions — {v}</dt><dd>{count(s.missions, k)}</dd></Fragment> : null)}
        </dl>
        {s.lastAnalysis && <p className="muted">Dernière analyse OSM : {dateTime(s.lastAnalysis.at)} (données OSM du {dateTime(s.lastAnalysis.osmTimestamp)}).</p>}
      </div>
      {canEdit && <DeleteEvent id={ev.id} name={ev.name} running={ev.status === 'en_cours'} />}
    </div>
  );
}

/** Suppression définitive : il faut retaper le nom de la manifestation. */
function DeleteEvent({ id, name, running }: { id: number; name: string; running: boolean }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const remove = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.delete('/api/events/' + id, { confirmName: typed });
      notifyEventsChanged();
      window.location.hash = '#/';
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Suppression impossible.');
      setBusy(false);
    }
  };
  return (
    <div className="card danger-zone">
      <h3>Supprimer la manifestation</h3>
      {!open ? (
        <>
          <p className="muted">Supprime définitivement le parcours, les suggestions, les points, les équipes, les missions et l’historique.</p>
          <button className="danger" onClick={() => setOpen(true)} disabled={running} title={running ? 'Impossible pendant la manifestation' : undefined}>Supprimer…</button>
          {running && <p className="muted small">Manifestation en cours : changez d’abord son statut.</p>}
        </>
      ) : (
        <form className="stack" onSubmit={remove}>
          <p>Cette action est <b>irréversible</b>. Pour confirmer, saisissez le nom de la manifestation : <b>{name}</b></p>
          <input aria-label="Nom de la manifestation à supprimer" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          {error && <p className="error">{error}</p>}
          <div className="row">
            <button className="danger" disabled={busy || typed.trim() !== name.trim()}>Supprimer définitivement</button>
            <button type="button" onClick={() => { setOpen(false); setTyped(''); }}>Annuler</button>
          </div>
        </form>
      )}
    </div>
  );
}
