import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { idParam, requireUser } from '../app.js';
import { audit } from '../audit.js';
import { tx } from '../db.js';
import { badRequest, conflict, HttpError } from '../errors.js';
import { DEFAULT_OPTIONS, analyse, excludedTypes, mergeOverpass, overpassQueries, type OverpassResponse, type Suggestion } from '../geo/osm-analysis.js';
import { simplify } from '../geo/route.js';
import { requireEntityAccess, requireEventRole } from '../permissions.js';
import { mergeSuggestions } from '../services/merge.js';
import { currentTrack } from '../services/track.js';

const AnalysisBody = z
  .object({
    routeTolerance: z.number().min(3).max(50),
    clusterRadius: z.number().min(0).max(80),
    includeNonMotor: z.boolean(),
    includeOutgoing: z.boolean(),
    corridor: z.number().min(10).max(150),
  })
  .partial()
  .default({});

const TYPE_LABEL: Record<string, string> = {
  carrefour: 'Carrefour',
  rue_laterale: 'Rue latérale',
  acces_vehicule_entrant: 'Accès véhicules',
  acces_pieton_cycle: 'Accès piéton / cycle',
  voie_privee: 'Voie privée',
  verification: 'À vérifier',
};

export function publicSuggestion(r: Record<string, unknown>) {
  const data = r.data as Suggestion;
  return {
    id: r.id,
    stableKey: r.stable_key,
    type: r.type,
    pertinence: r.pertinence,
    status: r.status,
    position: [r.lon, r.lat],
    distance: r.distance_m,
    passages: data.passages,
    routeNames: data.routeNames,
    branches: data.branches,
    restrictions: data.restrictions,
    nodeIds: data.nodeIds,
    reasons: data.reasons,
    uncertainties: data.uncertainties,
    pendingUpdate: r.pending_data ?? null,
    dismissedReason: r.dismissed_reason,
    decidedAt: r.decided_at,
    pointId: r.point_id ?? null,
    teams: r.teams ?? [],
    lastSeenAnalysisId: r.last_seen_analysis_id,
  };
}

const SUGGESTION_SELECT = `
  SELECT s.*, ST_X(s.geom) AS lon, ST_Y(s.geom) AS lat, p.id AS point_id,
         coalesce((SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color))
                     FROM missions m JOIN teams t ON t.id = m.team_id
                    WHERE m.mission_point_id = p.id AND m.cancelled_at IS NULL), '[]') AS teams
    FROM map_suggestions s
    LEFT JOIN mission_points p ON p.suggestion_id = s.id AND p.deleted_at IS NULL`;

export async function suggestionRoutes(app: FastifyInstance) {
  app.post('/api/events/:id/analyses', async (req, reply) => {
    const u = requireUser(req);
    const eventId = idParam(req);
    await requireEventRole(app.db, u, eventId, 'organisation');
    const b = AnalysisBody.parse(req.body ?? {});
    const track = await currentTrack(app.db, eventId);
    if (!track) throw badRequest("Importez d'abord un parcours GPX.");
    const options = { ...DEFAULT_OPTIONS, ...b };
    const corridor = b.corridor ?? 40;
    // Tracé simplifié à 10 m (le couloir de 40 m reste couvert), interrogé par tronçons successifs :
    // une seule grosse requête fait souvent échouer les serveurs publics (502, 504).
    const queries = overpassQueries(corridor, track.route.segments.map((s) => simplify(s, 10)));

    let data;
    try {
      const responses: OverpassResponse[] = [];
      for (const q of queries) responses.push(await app.osm(q));
      data = mergeOverpass(responses);
    } catch (e) {
      req.log.warn({ err: (e as Error).message, queries: queries.length }, 'échec Overpass');
      throw new HttpError(502, 'Données OSM indisponibles. ' + (e as Error).message);
    }
    const result = analyse(track.route, data, options);

    return tx(app.db, async (c) => {
      await c.query('SELECT 1 FROM events WHERE id = $1 FOR UPDATE', [eventId]);
      const a = (
        await c.query(
          `INSERT INTO osm_analyses(event_id, track_id, options, osm_timestamp, source, stats, report, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, '{}', $7) RETURNING id, created_at`,
          [eventId, track.id, JSON.stringify({ ...options, corridor }), result.osmTimestamp, app.config.overpassUrls.join(', '), JSON.stringify(result.stats), u.id],
        )
      ).rows[0];
      const merge = await mergeSuggestions(c, eventId, a.id, result.suggestions, excludedTypes(options));
      const report = {
        merge,
        ignoredCrossings: result.ignoredCrossings,
        unmatched: result.unmatched,
        coverage: result.coverage,
      };
      await c.query('UPDATE osm_analyses SET report = $2 WHERE id = $1', [a.id, JSON.stringify(report)]);
      await audit(c, {
        actorId: u.id, eventId, entity: 'osm_analysis', entityId: a.id, action: 'analyse',
        details: { added: merge.added.length, alreadyPresent: merge.alreadyPresent.length, modified: merge.modified.length, missing: merge.missing.length },
      });
      return reply.status(201).send({ id: a.id, createdAt: a.created_at, osmTimestamp: result.osmTimestamp, stats: result.stats, ...report });
    });
  });

  app.get('/api/events/:id/analyses', async (req) => {
    const u = requireUser(req);
    const eventId = idParam(req);
    await requireEventRole(app.db, u, eventId, 'lecture');
    const r = await app.db.query('SELECT id, track_id, created_at, osm_timestamp, options, stats, report FROM osm_analyses WHERE event_id = $1 ORDER BY id DESC', [eventId]);
    return r.rows.map((a) => ({ id: a.id, trackId: a.track_id, createdAt: a.created_at, osmTimestamp: a.osm_timestamp, options: a.options, stats: a.stats, report: a.report }));
  });

  app.get('/api/events/:id/suggestions', async (req) => {
    const u = requireUser(req);
    const eventId = idParam(req);
    await requireEventRole(app.db, u, eventId, 'lecture');
    const q = z
      .object({ status: z.enum(['a_examiner', 'validee', 'ecartee']).optional(), type: z.string().max(40).optional(), pertinence: z.enum(['elevee', 'moyenne', 'faible']).optional() })
      .parse(req.query);
    const r = await app.db.query(
      SUGGESTION_SELECT +
        ` WHERE s.event_id = $1 AND ($2::text IS NULL OR s.status = $2) AND ($3::text IS NULL OR s.type = $3) AND ($4::text IS NULL OR s.pertinence = $4)
          ORDER BY s.distance_m NULLS LAST, s.id`,
      [eventId, q.status ?? null, q.type ?? null, q.pertinence ?? null],
    );
    return r.rows.map(publicSuggestion);
  });

  // Valider : crée le point opérationnel correspondant (la suggestion reste intacte et liée).
  app.post('/api/suggestions/:id/validate', async (req, reply) => {
    const u = requireUser(req);
    const id = idParam(req);
    const b = z
      .object({
        name: z.string().trim().min(1).max(200).optional(),
        description: z.string().max(5000).optional(),
        /** Position choisie par l'organisateur (suggestion déplacée sur la carte) ; sinon celle d'OSM. */
        position: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]).optional(),
      })
      .parse(req.body ?? {});
    return tx(app.db, async (c) => {
      const eventId = await requireEntityAccess(c, u, 'map_suggestions', id, 'organisation');
      const s = (await c.query('SELECT *, ST_X(geom) AS lon, ST_Y(geom) AS lat FROM map_suggestions WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (s.status === 'validee') throw conflict('Suggestion déjà validée.');
      const existing = await c.query('SELECT id FROM mission_points WHERE suggestion_id = $1', [id]);
      if (existing.rowCount) throw conflict('Un point issu de cette suggestion existe déjà (éventuellement supprimé).');
      const data = s.data as Suggestion;
      const name = b.name ?? (TYPE_LABEL[s.type] ?? s.type) + (data.routeNames[0] ? ' — ' + data.routeNames[0] : '') +
        (data.branches[0]?.name ? ' / ' + data.branches[0].name : '');
      let distance = s.distance_m as number | null;
      if (b.position) distance = (await currentTrack(c, eventId))?.route.locate(b.position)?.distance ?? null;
      const p = (
        await c.query(
          `INSERT INTO mission_points(event_id, origin, suggestion_id, name, description, type, geom, distance_m, created_by)
           VALUES ($1, 'suggestion', $2, $3, $4, $5,
                   CASE WHEN $9::float8 IS NULL THEN $6::geometry ELSE ST_SetSRID(ST_MakePoint($9, $10), 4326) END, $7, $8)
           RETURNING id`,
          [eventId, id, name.slice(0, 200), b.description ?? data.reasons.join('\n'), s.type, s.geom, distance, u.id,
            b.position?.[0] ?? null, b.position?.[1] ?? null],
        )
      ).rows[0];
      await c.query("UPDATE map_suggestions SET status = 'validee', decided_at = now(), decided_by = $2 WHERE id = $1", [id, u.id]);
      await audit(c, { actorId: u.id, eventId, entity: 'map_suggestion', entityId: id, action: 'validation', details: { pointId: p.id, position: b.position } });
      await audit(c, { actorId: u.id, eventId, entity: 'mission_point', entityId: p.id, action: 'creation', details: { origin: 'suggestion', suggestionId: id, name } });
      return reply.status(201).send({ pointId: p.id });
    });
  });

  // Écarter : la suggestion est conservée avec sa clé pour ne pas réapparaître lors d'une nouvelle analyse.
  app.post('/api/suggestions/:id/dismiss', async (req) => {
    const u = requireUser(req);
    const id = idParam(req);
    const b = z.object({ reason: z.string().trim().max(1000).optional() }).parse(req.body ?? {});
    return tx(app.db, async (c) => {
      const eventId = await requireEntityAccess(c, u, 'map_suggestions', id, 'organisation');
      const point = await c.query('SELECT id FROM mission_points WHERE suggestion_id = $1 AND deleted_at IS NULL', [id]);
      if (point.rowCount) throw conflict('Cette suggestion a donné un point de mission : supprimez d\'abord le point.', { pointId: point.rows[0].id });
      await c.query("UPDATE map_suggestions SET status = 'ecartee', dismissed_reason = $2, decided_at = now(), decided_by = $3 WHERE id = $1", [id, b.reason ?? null, u.id]);
      await audit(c, { actorId: u.id, eventId, entity: 'map_suggestion', entityId: id, action: 'exclusion', details: { reason: b.reason } });
      return { ok: true };
    });
  });

  // Écarter d'un coup toutes les suggestions à examiner d'un type (ex. rues sortantes). Celles qui ont déjà donné
  // un point de mission ne sont pas concernées. Elles restent mémorisées et ne réapparaissent pas.
  app.post('/api/events/:id/suggestions/dismiss-type', async (req) => {
    const u = requireUser(req);
    const eventId = idParam(req);
    const b = z.object({ type: z.string().max(40), reason: z.string().trim().max(1000).optional() }).parse(req.body);
    return tx(app.db, async (c) => {
      await requireEventRole(c, u, eventId, 'organisation');
      const r = await c.query(
        `UPDATE map_suggestions s SET status = 'ecartee', dismissed_reason = $3, decided_at = now(), decided_by = $4
          WHERE s.event_id = $1 AND s.type = $2 AND s.status = 'a_examiner'
            AND NOT EXISTS (SELECT 1 FROM mission_points p WHERE p.suggestion_id = s.id AND p.deleted_at IS NULL)
          RETURNING s.id`,
        [eventId, b.type, b.reason ?? null, u.id],
      );
      const ids = r.rows.map((x) => x.id as number);
      await audit(c, { actorId: u.id, eventId, entity: 'map_suggestion', entityId: null, action: 'exclusion_groupee', details: { type: b.type, reason: b.reason, ids } });
      return { dismissed: ids.length };
    });
  });

  // Revenir sur une exclusion.
  app.post('/api/suggestions/:id/reopen', async (req) => {
    const u = requireUser(req);
    const id = idParam(req);
    return tx(app.db, async (c) => {
      const eventId = await requireEntityAccess(c, u, 'map_suggestions', id, 'organisation');
      const r = await c.query("UPDATE map_suggestions SET status = 'a_examiner', dismissed_reason = NULL, decided_at = now(), decided_by = $2 WHERE id = $1 AND status = 'ecartee'", [id, u.id]);
      if (!r.rowCount) throw conflict("Seule une suggestion écartée peut être réexaminée.");
      await audit(c, { actorId: u.id, eventId, entity: 'map_suggestion', entityId: id, action: 'reexamen' });
      return { ok: true };
    });
  });

  // Appliquer ou ignorer une modification détectée par une nouvelle analyse.
  app.post('/api/suggestions/:id/pending', async (req) => {
    const u = requireUser(req);
    const id = idParam(req);
    const b = z.object({ action: z.enum(['appliquer', 'ignorer']) }).parse(req.body);
    return tx(app.db, async (c) => {
      const eventId = await requireEntityAccess(c, u, 'map_suggestions', id, 'organisation');
      const s = (await c.query('SELECT pending_data FROM map_suggestions WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!s.pending_data) throw conflict('Aucune modification en attente.');
      if (b.action === 'appliquer') {
        const d = s.pending_data as Suggestion;
        // Le statut et un éventuel point opérationnel restent inchangés.
        await c.query(
          `UPDATE map_suggestions SET data = pending_data, pending_data = NULL, type = $2, pertinence = $3,
                  geom = ST_SetSRID(ST_MakePoint($4, $5), 4326), distance_m = $6 WHERE id = $1`,
          [id, d.type, d.pertinence, d.position[0], d.position[1], d.distance],
        );
      } else {
        await c.query('UPDATE map_suggestions SET pending_data = NULL WHERE id = $1', [id]);
      }
      await audit(c, { actorId: u.id, eventId, entity: 'map_suggestion', entityId: id, action: 'mise_a_jour_osm_' + b.action });
      return { ok: true };
    });
  });
}
