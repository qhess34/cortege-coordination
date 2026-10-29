// Analyse OSM d'un événement : interrogation d'Overpass par tronçons, analyse, fusion non destructive.
// Utilisée directement (requête qui attend le résultat) ou en tâche de fond (suivi de l'avancement).
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { audit } from '../audit.js';
import { tx } from '../db.js';
import { HttpError, badRequest } from '../errors.js';
import { DEFAULT_OPTIONS, analyse, excludedTypes, mergeOverpass, overpassQueries, type AnalysisOptions, type OverpassResponse } from '../geo/osm-analysis.js';
import { streetNetwork } from '../geo/place-name.js';
import { simplify } from '../geo/route.js';
import { mergeSuggestions } from './merge.js';
import { currentTrack } from './track.js';

export type AnalysisBody = Partial<AnalysisOptions> & { corridor?: number };
export type Progress = (done: number, total: number) => void;

export async function runAnalysis(app: FastifyInstance, userId: number, eventId: number, b: AnalysisBody, progress: Progress = () => {}) {
  const track = await currentTrack(app.db, eventId);
  if (!track) throw badRequest("Importez d'abord un parcours GPX.");
  const options = { ...DEFAULT_OPTIONS, ...b };
  const corridor = b.corridor ?? 40;
  // Tracé simplifié à 10 m (le couloir de 40 m reste couvert), interrogé par tronçons successifs :
  // une seule grosse requête fait souvent échouer les serveurs publics (502, 504).
  const queries = overpassQueries(corridor, track.route.segments.map((s) => simplify(s, 10)));

  const responses: OverpassResponse[] = [];
  let emptyChunks = 0;
  progress(0, queries.length);
  try {
    for (const q of queries) {
      const r = await app.osm(q, { requireWays: true });
      if (!r.elements.some((e) => e.type === 'way')) emptyChunks++;
      responses.push(r);
      progress(responses.length, queries.length);
    }
  } catch (e) {
    app.log.warn({ err: (e as Error).message, queries: queries.length }, 'échec Overpass');
    throw new HttpError(502, 'Données OSM indisponibles. ' + (e as Error).message);
  }
  // Un parcours suit des voies : ne recevoir aucune voie nulle part signale un service dégradé, pas une absence de
  // carrefours. On ne présente donc pas ce résultat comme « aucune suggestion ».
  if (emptyChunks === queries.length) {
    throw new HttpError(
      502,
      'Overpass n’a renvoyé aucune voie autour du parcours : le service est probablement surchargé ou dégradé. ' +
        'Rien n’a été modifié. Réessayez dans quelques minutes, ou configurez un autre serveur (OVERPASS_URL).',
    );
  }
  const data = mergeOverpass(responses);
  const result = analyse(track.route, data, options);
  const warnings: string[] = [];
  if (emptyChunks) {
    warnings.push(
      'Overpass n’a renvoyé aucune voie pour ' + emptyChunks + ' tronçon(s) sur ' + queries.length +
        ' : ces portions n’ont peut-être pas été analysées. Relancez l’analyse un peu plus tard.',
    );
  }

  return tx(app.db, async (c) => {
    await c.query('SELECT 1 FROM events WHERE id = $1 FOR UPDATE', [eventId]);
    const a = (
      await c.query(
        `INSERT INTO osm_analyses(event_id, track_id, options, osm_timestamp, source, stats, report, created_by, streets)
         VALUES ($1, $2, $3, $4, $5, $6, '{}', $7, $8) RETURNING id, created_at`,
        [eventId, track.id, JSON.stringify({ ...options, corridor }), result.osmTimestamp, app.config.overpassUrls.join(', '),
          JSON.stringify({ ...result.stats, chunks: queries.length, emptyChunks }), userId, JSON.stringify(streetNetwork(data))],
      )
    ).rows[0];
    const merge = await mergeSuggestions(c, eventId, a.id, result.suggestions, excludedTypes(options));
    const report = { merge, ignoredCrossings: result.ignoredCrossings, unmatched: result.unmatched, coverage: result.coverage, warnings };
    await c.query('UPDATE osm_analyses SET report = $2 WHERE id = $1', [a.id, JSON.stringify(report)]);
    await audit(c, {
      actorId: userId, eventId, entity: 'osm_analysis', entityId: a.id, action: 'analyse',
      details: { added: merge.added.length, alreadyPresent: merge.alreadyPresent.length, modified: merge.modified.length, missing: merge.missing.length },
    });
    return { id: a.id, createdAt: a.created_at, osmTimestamp: result.osmTimestamp, stats: result.stats, ...report };
  });
}

/** Analyse en tâche de fond (une instance de serveur) : évite la coupure par un proxy sur une analyse longue. */
export interface AnalysisJob {
  id: string;
  eventId: number;
  status: 'en_cours' | 'termine' | 'echec';
  progress: { done: number; total: number };
  result?: unknown;
  error?: string;
  startedAt: number;
}
const jobs = new Map<string, AnalysisJob>();
const JOB_TTL_MS = 3600_000;

export function startAnalysisJob(app: FastifyInstance, userId: number, eventId: number, b: AnalysisBody): AnalysisJob {
  for (const [id, j] of jobs) if (Date.now() - j.startedAt > JOB_TTL_MS) jobs.delete(id);
  // Une seule analyse à la fois par événement : on rattache la demande à celle en cours.
  const running = [...jobs.values()].find((j) => j.eventId === eventId && j.status === 'en_cours');
  if (running) return running;
  const job: AnalysisJob = { id: randomBytes(12).toString('base64url'), eventId, status: 'en_cours', progress: { done: 0, total: 0 }, startedAt: Date.now() };
  jobs.set(job.id, job);
  runAnalysis(app, userId, eventId, b, (done, total) => { job.progress = { done, total }; }).then(
    (result) => { job.status = 'termine'; job.result = result; },
    (e: Error) => { job.status = 'echec'; job.error = e instanceof HttpError ? e.message : 'Erreur interne pendant l’analyse.'; if (!(e instanceof HttpError)) app.log.error(e); },
  );
  return job;
}

export function getAnalysisJob(id: string): AnalysisJob | undefined {
  return jobs.get(id);
}
