import { useState } from 'react';
import { api } from '../../api';
import { TYPE_COLORS } from '../../components/MapView';
import { FLOW, MOTOR, PERTINENCE, SUGGESTION_STATUS, SUGGESTION_TYPES, coords, km, suggestionPlace } from '../../labels';
import type { Suggestion } from '../../types';
import type { PanelProps } from '../EventPage';

interface MergeReport {
  added: { id: number; stableKey: string; duplicateOfPoint: { id: number; name: string } | null }[];
  alreadyPresent: unknown[];
  modified: { id: number; stableKey: string; changes: string[] }[];
  ignoredDismissed: unknown[];
  missing: { id: number; stableKey: string; status: string; hasPoint: boolean }[];
}
interface AnalysisReport {
  merge: MergeReport; coverage: number; unmatched: [number, number][]; osmTimestamp: string | null;
  ignoredCrossings: { wayIds: [number, number]; distance: number; reason: string }[];
}

export function SuggestionsPanel({ data, canEdit, run, selection, select }: PanelProps) {
  const [status, setStatus] = useState('a_examiner');
  const [type, setType] = useState('');
  const [pertinence, setPertinence] = useState('');
  // Options reprises de la dernière analyse, pour qu'une relance garde les mêmes choix.
  const last = data.summary.lastAnalysis?.options;
  const [includeNonMotor, setIncludeNonMotor] = useState(last?.includeNonMotor ?? true);
  const [includeOutgoing, setIncludeOutgoing] = useState(last?.includeOutgoing ?? false);
  const [perAccess, setPerAccess] = useState(last?.perAccess ?? true);
  const toReview = (type: string) => data.suggestions.filter((s) => s.type === type && s.status === 'a_examiner' && !s.pointId).length;
  const outgoingToReview = toReview('rue_laterale');
  const nonMotorToReview = toReview('acces_pieton_cycle');
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [busy, setBusy] = useState(false);

  const list = data.suggestions.filter((s) => (!status || s.status === status) && (!type || s.type === type) && (!pertinence || s.pertinence === pertinence));
  const current = selection?.kind === 'suggestion' ? data.suggestions.find((s) => s.id === selection.id) : undefined;

  const analyse = async () => {
    setBusy(true);
    await run(async () => setReport(await api.post<AnalysisReport>('/api/events/' + data.event.id + '/analyses', { includeNonMotor, includeOutgoing, perAccess })), 'Analyse terminée.');
    setBusy(false);
  };

  return (
    <div className="stack">
      {canEdit && (
        <div className="card">
          <h3>Analyse du réseau OSM</h3>
          <p className="muted">
            Nouvelle analyse non destructive : les points, validations, exclusions et affectations sont conservés ; les
            suggestions écartées ne réapparaissent pas.
          </p>
          <label className="check"><input type="checkbox" checked={includeNonMotor} onChange={(e) => setIncludeNonMotor(e.target.checked)} /> Inclure les accès piétons et cyclables</label>
          <label className="check" title="Voies à sens unique depuis le parcours : aucun véhicule ne peut en arriver d’après OSM">
            <input type="checkbox" checked={includeOutgoing} onChange={(e) => setIncludeOutgoing(e.target.checked)} /> Inclure les rues sortantes (sens unique depuis le parcours)
          </label>
          <label className="check" title="Décoché : un seul point au centre de chaque carrefour">
            <input type="checkbox" checked={perAccess} onChange={(e) => setPerAccess(e.target.checked)} /> Un point par accès entrant (chaque côté d’où l’on peut arriver)
          </label>
          <button className="primary" disabled={busy || !data.track} onClick={analyse}>{busy ? 'Analyse en cours…' : data.summary.lastAnalysis ? 'Relancer l’analyse' : 'Lancer l’analyse'}</button>
          {!data.track && <p className="muted">Importez d’abord un parcours.</p>}
          <p className="muted small">
            Ces options s’appliquent aux prochaines analyses : les suggestions déjà proposées restent jusqu’à ce que vous
            les écartiez.
          </p>
          {nonMotorToReview > 0 && (
            <button onClick={() => {
              if (!window.confirm('Écarter les ' + nonMotorToReview + ' accès piéton(s) ou cyclable(s) à examiner ? Ils ne réapparaîtront pas lors des prochaines analyses (vous pourrez les réexaminer un à un).')) return;
              void run(() => api.post('/api/events/' + data.event.id + '/suggestions/dismiss-type', { type: 'acces_pieton_cycle', reason: 'Accès piéton ou cyclable' }), nonMotorToReview + ' accès piéton(s) ou cyclable(s) écarté(s).');
            }}>Écarter les {nonMotorToReview} accès piéton(s) ou cyclable(s) à examiner</button>
          )}
          {outgoingToReview > 0 && (
            <button onClick={() => {
              if (!window.confirm('Écarter les ' + outgoingToReview + ' rue(s) sortante(s) à examiner ? Elles ne réapparaîtront pas lors des prochaines analyses (vous pourrez les réexaminer une à une).')) return;
              void run(() => api.post('/api/events/' + data.event.id + '/suggestions/dismiss-type', { type: 'rue_laterale', reason: 'Rue sortante (sens unique depuis le parcours)' }), outgoingToReview + ' rue(s) sortante(s) écartée(s).');
            }}>Écarter les {outgoingToReview} rue(s) sortante(s) à examiner</button>
          )}
          {report && <AnalysisSummary report={report} select={select} />}
        </div>
      )}

      <div className="filters">
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Statut">
          <option value="">Tous statuts</option>
          {Object.entries(SUGGESTION_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
          <option value="">Tous types</option>
          {Object.keys(TYPE_COLORS).map((k) => <option key={k} value={k}>{SUGGESTION_TYPES[k]}</option>)}
        </select>
        <select value={pertinence} onChange={(e) => setPertinence(e.target.value)} aria-label="Pertinence">
          <option value="">Toute pertinence</option>
          {Object.entries(PERTINENCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {current && <SuggestionDetail s={current} canEdit={canEdit} run={run} select={select} />}

      <ul className="items">
        {list.map((s) => (
          <li key={s.id} className={current?.id === s.id ? 'selected' : ''} onClick={() => select({ kind: 'suggestion', id: s.id })}>
            <span className="dot" style={{ background: TYPE_COLORS[s.type] ?? '#999' }} />
            <span className="grow">
              <b>{SUGGESTION_TYPES[s.type] ?? s.type}</b> — {suggestionPlace(s)}
              <br /><span className="muted">{km(s.distance)} · pertinence {PERTINENCE[s.pertinence]?.toLowerCase()} · {SUGGESTION_STATUS[s.status]}</span>
              {s.uncertainties.length > 0 && <span className="badge warn" title={s.uncertainties.join('\n')}>incertain</span>}
              {s.pendingUpdate ? <span className="badge">OSM modifié</span> : null}
            </span>
          </li>
        ))}
        {list.length === 0 && <li className="muted">Aucune suggestion pour ces filtres.</li>}
      </ul>
    </div>
  );
}

function AnalysisSummary({ report, select }: { report: AnalysisReport; select: PanelProps['select'] }) {
  const m = report.merge;
  return (
    <div className="report">
      <p>
        <b>{m.added.length}</b> nouvelle(s), <b>{m.alreadyPresent.length}</b> déjà présente(s), <b>{m.ignoredDismissed.length}</b> écartée(s) ignorée(s).
        Parcours reconnu sur les voies OSM à {Math.round(report.coverage * 100)} %.
      </p>
      {m.added.filter((a) => a.duplicateOfPoint).map((a) => (
        <p key={a.id} className="warning">Doublon possible : la suggestion <button className="link" onClick={() => select({ kind: 'suggestion', id: a.id })}>{a.stableKey}</button> est proche du point « {a.duplicateOfPoint!.name} ».</p>
      ))}
      {m.modified.length > 0 && (
        <div className="warning"><b>Modifications OSM à examiner (non appliquées) :</b>
          <ul>{m.modified.map((x) => <li key={x.id}><button className="link" onClick={() => select({ kind: 'suggestion', id: x.id })}>{x.stableKey}</button> : {x.changes.join(' ')}</li>)}</ul>
        </div>
      )}
      {m.missing.length > 0 && (
        <div className="warning"><b>Absentes de cette analyse (conservées) :</b>
          <ul>{m.missing.map((x) => <li key={x.id}><button className="link" onClick={() => select({ kind: 'suggestion', id: x.id })}>{x.stableKey}</button>{x.hasPoint ? ' — liée à un point de mission' : ''}</li>)}</ul>
        </div>
      )}
      {report.unmatched.length > 0 && (
        <p className="warning">Portions du parcours sans voie OSM reconnue : {report.unmatched.map(([a, b]) => km(a) + '–' + km(b)).join(', ')}. Les accès y sont à repérer manuellement.</p>
      )}
      {report.ignoredCrossings.length > 0 && (
        <details><summary>{report.ignoredCrossings.length} croisement(s) dénivelé(s) non retenu(s)</summary>
          <ul>{report.ignoredCrossings.map((c, i) => <li key={i}>{km(c.distance)} : {c.reason} (voies {c.wayIds.join(' et ')})</li>)}</ul>
        </details>
      )}
    </div>
  );
}

function SuggestionDetail({ s, canEdit, run, select }: { s: Suggestion; canEdit: boolean; run: PanelProps['run']; select: PanelProps['select'] }) {
  const [reason, setReason] = useState('');
  return (
    <div className="card detail">
      <h3>{SUGGESTION_TYPES[s.type] ?? s.type} <span className="muted">#{s.id}</span></h3>
      <dl className="kv">
        <dt>Statut</dt><dd>{SUGGESTION_STATUS[s.status]}{s.dismissedReason ? ' — ' + s.dismissedReason : ''}</dd>
        <dt>Voie du parcours</dt><dd>{s.routeNames.join(', ') || 'non renseignée'}</dd>
        <dt>Distance</dt><dd>{s.passages.length > 1 ? s.passages.map(km).join(' et ') : km(s.distance)}</dd>
        <dt>Coordonnées</dt><dd>{coords(s.position)}</dd>
        <dt>Pertinence estimée</dt><dd>{PERTINENCE[s.pertinence]}</dd>
        <dt>Identifiant</dt><dd><code>{s.stableKey}</code></dd>
        {s.teams.length > 0 && <><dt>Équipe(s)</dt><dd>{s.teams.map((t) => t.name).join(', ')}</dd></>}
      </dl>
      <h4>Motif de la détection</h4>
      <ul>{s.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
      <h4>Voies raccordées</h4>
      <ul>
        {s.branches.map((b) => (
          <li key={b.wayId}>
            <a href={'https://www.openstreetmap.org/way/' + b.wayId} target="_blank" rel="noreferrer">{b.name ?? 'voie ' + b.wayId}</a>
            {' '}({b.highway}, {MOTOR[b.motor]}{b.motor !== 'non' ? ', ' + FLOW[b.flow] : ''}{b.crossing ? ', traversante' : ''})
            <details><summary>Attributs OSM</summary><code className="tags">{Object.entries(b.tags).map(([k, v]) => k + '=' + v).join('\n')}</code></details>
          </li>
        ))}
      </ul>
      {s.restrictions.length > 0 && <><h4>Restrictions de tournant</h4><ul>{s.restrictions.map((r) => <li key={r.relationId}>{r.restriction} (relation {r.relationId})</li>)}</ul></>}
      {s.uncertainties.length > 0 && <><h4>Incertitudes</h4><ul className="warnings">{s.uncertainties.map((u, i) => <li key={i}>{u}</li>)}</ul></>}
      {s.nodeIds[0] && <p><a href={'https://www.openstreetmap.org/node/' + s.nodeIds[0]} target="_blank" rel="noreferrer">Voir sur openstreetmap.org</a></p>}

      {canEdit && (
        <div className="actions">
          {s.status === 'a_examiner' && (
            <>
              <button className="primary" onClick={() => run(async () => {
                const r = await api.post<{ pointId: number }>('/api/suggestions/' + s.id + '/validate');
                select({ kind: 'point', id: r.pointId });
              }, 'Suggestion validée : point de mission créé.')}>Valider</button>
              <input placeholder="Motif (facultatif)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <button onClick={() => run(() => api.post('/api/suggestions/' + s.id + '/dismiss', { reason: reason || undefined }), 'Suggestion écartée.')}>Écarter</button>
            </>
          )}
          {s.status === 'ecartee' && <button onClick={() => run(() => api.post('/api/suggestions/' + s.id + '/reopen'), 'Suggestion remise à examiner.')}>Réexaminer</button>}
          {s.status === 'validee' && s.pointId && <button onClick={() => select({ kind: 'point', id: s.pointId! })}>Voir le point de mission</button>}
          {s.pendingUpdate ? (
            <div className="warning">
              Les données OSM de ce point ont changé lors de la dernière analyse.
              <button onClick={() => run(() => api.post('/api/suggestions/' + s.id + '/pending', { action: 'appliquer' }), 'Mise à jour appliquée.')}>Appliquer</button>
              <button onClick={() => run(() => api.post('/api/suggestions/' + s.id + '/pending', { action: 'ignorer' }), 'Mise à jour ignorée.')}>Ignorer</button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
