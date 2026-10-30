-- Lieux : regroupement des points d'un même carrefour (un point par accès) pour l'export GPX et le suivi.
-- Chaque point reste un point de mission à part entière ; le lieu ne sert qu'à les présenter ensemble.
CREATE TABLE places (
  id          bigserial PRIMARY KEY,
  event_id    bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  -- Carrefour OSM d'origine (lieu créé automatiquement à la validation des suggestions), sinon NULL (regroupement manuel).
  osm_node    bigint,
  -- Centre : le carrefour, ou le barycentre des points regroupés à la main.
  geom        geometry(Point, 4326) NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, osm_node)
);
CREATE INDEX places_event_idx ON places(event_id);

ALTER TABLE mission_points ADD COLUMN place_id bigint REFERENCES places(id) ON DELETE SET NULL;
CREATE INDEX mission_points_place_idx ON mission_points(place_id);

-- Reprise : les points déjà issus d'un accès de carrefour rejoignent le lieu de leur carrefour.
INSERT INTO places(event_id, name, osm_node, geom)
SELECT DISTINCT ON (s.event_id, (s.data->'junction'->>'nodeId')::bigint)
       s.event_id,
       regexp_replace(p.name, ' \(accès [^)]*\)$', ''),
       (s.data->'junction'->>'nodeId')::bigint,
       ST_SetSRID(ST_MakePoint((s.data->'junction'->'position'->>0)::float8, (s.data->'junction'->'position'->>1)::float8), 4326)
  FROM mission_points p JOIN map_suggestions s ON s.id = p.suggestion_id
 WHERE s.data->'junction' IS NOT NULL AND s.data->'junction'->>'nodeId' IS NOT NULL
 ORDER BY s.event_id, (s.data->'junction'->>'nodeId')::bigint, p.id;

UPDATE mission_points p SET place_id = pl.id
  FROM map_suggestions s, places pl
 WHERE s.id = p.suggestion_id AND pl.event_id = s.event_id
   AND pl.osm_node = (s.data->'junction'->>'nodeId')::bigint;
