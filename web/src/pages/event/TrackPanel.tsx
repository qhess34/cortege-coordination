import { useRef, useState } from 'react';
import { ApiError, api } from '../../api';
import { dateTime, km } from '../../labels';
import type { PanelProps } from '../EventPage';

interface Impact { kind: 'point' | 'suggestion'; id: number; name: string; missions: number; reason: string }
interface Preview { track: { name: string | null; length: number; closed: boolean; segments: number; waypoints: number; warnings: string[] }; impact: Impact[] }

export function TrackPanel({ data, canEdit, run }: PanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const url = '/api/events/' + data.event.id + '/tracks';

  const choose = async (f: File | null) => {
    setFile(f);
    setPreview(null);
    setError(null);
    if (!f) return;
    const fd = new FormData();
    fd.append('file', f);
    try {
      setPreview(await api.post<Preview>(url + '?preview=1', fd));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Lecture impossible.');
    }
  };

  const confirm = async () => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    const ok = await run(() => api.post(url + '?confirm=1', fd), data.track ? 'Parcours remplacé. Pensez à relancer l’analyse OSM.' : 'Parcours importé.');
    if (ok) {
      setFile(null);
      setPreview(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const t = data.track;
  return (
    <div className="stack">
      {t ? (
        <div className="card">
          <h3>{t.name ?? t.filename} <span className="muted">version {t.version}</span></h3>
          <dl className="kv">
            <dt>Longueur</dt><dd>{km(t.length)}</dd>
            <dt>Forme</dt><dd>{t.closed ? 'Boucle (départ = arrivée)' : 'Trajet ouvert'}</dd>
            <dt>Segments</dt><dd>{t.geometry.coordinates.length}</dd>
            <dt>Importé le</dt><dd>{dateTime(t.createdAt)}</dd>
          </dl>
          {t.warnings.length > 0 && <><h4>Avertissements</h4><ul className="warnings">{t.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></>}
          {data.waypoints.length > 0 && (
            <><h4>Points de passage</h4>
              <ul className="plain">{data.waypoints.map((w) => <li key={w.id}>{w.name ?? 'Sans nom'} — {km(w.distance)}</li>)}</ul></>
          )}
        </div>
      ) : <p className="muted">Aucun parcours importé.</p>}

      {canEdit && (
        <div className="card">
          <h3>{t ? 'Remplacer le parcours' : 'Importer un fichier GPX'}</h3>
          <input ref={fileRef} type="file" accept=".gpx,application/gpx+xml,application/xml,text/xml" onChange={(e) => choose(e.target.files?.[0] ?? null)} />
          {error && <p className="error">{error}</p>}
          {preview && (
            <div className="stack">
              <p>{preview.track.name ?? file?.name} : {km(preview.track.length)}, {preview.track.segments} segment(s){preview.track.closed ? ', boucle' : ''}.</p>
              {preview.track.warnings.length > 0 && <ul className="warnings">{preview.track.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
              {preview.impact.length > 0 && (
                <div className="warning">
                  <b>{preview.impact.length} élément(s) existant(s) concerné(s)</b> — aucun ne sera supprimé, mais vérifiez-les après remplacement :
                  <ul>{preview.impact.map((i) => <li key={i.kind + i.id}>{i.kind === 'point' ? 'Point' : 'Suggestion'} « {i.name} »{i.missions ? ' (' + i.missions + ' mission(s))' : ''} : {i.reason}</li>)}</ul>
                </div>
              )}
              <button className="primary" onClick={confirm}>{t ? 'Confirmer le remplacement' : 'Importer'}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
