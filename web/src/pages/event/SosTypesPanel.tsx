// Types de SOS configurables par l'organisation : proposés dans la fenêtre SOS de la vue terrain.
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api';
import type { SosType } from '../../components/FieldView';
import type { PanelProps } from '../EventPage';

export function SosTypesPanel({ data, canEdit, run }: PanelProps) {
  const base = '/api/events/' + data.event.id + '/sos-types';
  const [types, setTypes] = useState<SosType[]>([]);
  const [label, setLabel] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const load = useCallback(() => { api.get<SosType[]>(base).then(setTypes, () => undefined); }, [base]);
  useEffect(load, [load]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return;
    if (await run(() => api.post(base, { label }), 'Type de SOS ajouté.')) { setLabel(''); load(); }
  };
  const rename = async (id: number) => {
    if (await run(() => api.patch(base + '/' + id, { label: draft }), 'Type renommé.')) { setEditing(null); load(); }
  };
  const remove = async (id: number, lbl: string) => {
    if (!window.confirm('Retirer le type « ' + lbl + ' » ? Les SOS déjà signalés le gardent.')) return;
    if (await run(() => api.delete(base + '/' + id), 'Type retiré.')) load();
  };

  return (
    <div className="card stack" data-testid="sos-types">
      <h3>Types de SOS</h3>
      <p className="muted small">Proposés dans la fenêtre SOS de la vue terrain. Les SOS déjà signalés gardent leur libellé même si le type est modifié ou retiré.</p>
      <ul className="plain">
        {types.map((t) => (
          <li key={t.id} className="row">
            {editing === t.id ? (
              <>
                <input className="grow" value={draft} maxLength={60} onChange={(e) => setDraft(e.target.value)} aria-label="Nom du type" />
                <button className="primary" disabled={!draft.trim()} onClick={() => rename(t.id)}>Enregistrer</button>
                <button onClick={() => setEditing(null)}>Annuler</button>
              </>
            ) : (
              <>
                <span className="grow">🆘 {t.label}</span>
                {canEdit && <button onClick={() => { setEditing(t.id); setDraft(t.label); }}>Renommer</button>}
                {canEdit && <button className="danger" onClick={() => remove(t.id, t.label)}>Retirer</button>}
              </>
            )}
          </li>
        ))}
        {types.length === 0 && <li className="muted">Aucun type de SOS.</li>}
      </ul>
      {canEdit && (
        <form className="row" onSubmit={add}>
          <input className="grow" value={label} maxLength={60} placeholder="Nouveau type de SOS" onChange={(e) => setLabel(e.target.value)} aria-label="Nouveau type de SOS" />
          <button className="primary" disabled={!label.trim()}>Ajouter</button>
        </form>
      )}
    </div>
  );
}
