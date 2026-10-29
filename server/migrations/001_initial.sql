-- Schéma initial (phase 1) : comptes administrés, sessions, événements, parcours, analyses OSM,
-- suggestions, points de mission, équipes, missions, journal d'audit.

CREATE EXTENSION IF NOT EXISTS postgis;

-- Comptes créés uniquement par un administrateur. Aucune inscription publique.
CREATE TABLE users (
  id            bigserial PRIMARY KEY,
  login         text NOT NULL UNIQUE CHECK (login ~ '^[a-z0-9._-]{3,64}$'),
  display_name  text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
  password_hash text,
  global_role   text NOT NULL DEFAULT 'aucun' CHECK (global_role IN ('admin', 'organisateur', 'aucun')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    bigint REFERENCES users(id) ON DELETE SET NULL,
  disabled_at   timestamptz
);

-- Sessions : seul le hash SHA-256 du jeton est stocké.
CREATE TABLE sessions (
  id           bigserial PRIMARY KEY,
  token_hash   bytea NOT NULL UNIQUE,
  user_id      bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  user_agent   text
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE events (
  id               bigserial PRIMARY KEY,
  name             text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  description      text NOT NULL DEFAULT '',
  starts_at        timestamptz,
  ends_at          timestamptz CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at >= starts_at),
  area_name        text NOT NULL DEFAULT '',
  status           text NOT NULL DEFAULT 'preparation'
                   CHECK (status IN ('preparation', 'pret', 'en_cours', 'termine', 'archive')),
  instructions     text NOT NULL DEFAULT '',
  current_track_id bigint,
  version          integer NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       bigint REFERENCES users(id) ON DELETE SET NULL,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Accès d'un compte à un événement. L'administrateur a accès à tout sans appartenance.
CREATE TABLE event_memberships (
  event_id   bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('organisateur', 'responsable', 'membre')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX event_memberships_user_idx ON event_memberships(user_id);

-- Versions successives du parcours. Une nouvelle version ne supprime jamais l'ancienne.
CREATE TABLE gpx_tracks (
  id          bigserial PRIMARY KEY,
  event_id    bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  version     integer NOT NULL,
  name        text,
  filename    text NOT NULL,
  geom        geometry(MultiLineString, 4326) NOT NULL,
  length_m    double precision NOT NULL,
  closed      boolean NOT NULL,
  warnings    jsonb NOT NULL DEFAULT '[]',
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  bigint REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (event_id, version)
);
CREATE INDEX gpx_tracks_geom_idx ON gpx_tracks USING gist(geom);
ALTER TABLE events ADD CONSTRAINT events_current_track_fk
  FOREIGN KEY (current_track_id) REFERENCES gpx_tracks(id) ON DELETE SET NULL;

CREATE TABLE route_points (
  id         bigserial PRIMARY KEY,
  track_id   bigint NOT NULL REFERENCES gpx_tracks(id) ON DELETE CASCADE,
  name       text,
  geom       geometry(Point, 4326) NOT NULL,
  distance_m double precision
);
CREATE INDEX route_points_track_idx ON route_points(track_id);

CREATE TABLE osm_analyses (
  id             bigserial PRIMARY KEY,
  event_id       bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  track_id       bigint NOT NULL REFERENCES gpx_tracks(id) ON DELETE RESTRICT,
  options        jsonb NOT NULL,
  osm_timestamp  text,
  source         text NOT NULL,
  stats          jsonb NOT NULL,
  report         jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     bigint REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX osm_analyses_event_idx ON osm_analyses(event_id);

-- Suggestions issues de l'analyse OSM. Jamais supprimées par une nouvelle analyse :
-- une suggestion écartée garde sa clé et ne réapparaît pas.
CREATE TABLE map_suggestions (
  id                     bigserial PRIMARY KEY,
  event_id               bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  stable_key             text NOT NULL,
  type                   text NOT NULL,
  pertinence             text NOT NULL CHECK (pertinence IN ('elevee', 'moyenne', 'faible')),
  status                 text NOT NULL DEFAULT 'a_examiner' CHECK (status IN ('a_examiner', 'validee', 'ecartee')),
  geom                   geometry(Point, 4326) NOT NULL,
  distance_m             double precision,
  data                   jsonb NOT NULL,
  first_analysis_id      bigint NOT NULL REFERENCES osm_analyses(id) ON DELETE RESTRICT,
  last_seen_analysis_id  bigint NOT NULL REFERENCES osm_analyses(id) ON DELETE RESTRICT,
  -- Modification détectée par une nouvelle analyse, en attente de décision de l'organisateur.
  pending_data           jsonb,
  dismissed_reason       text,
  decided_at             timestamptz,
  decided_by             bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, stable_key)
);
CREATE INDEX map_suggestions_geom_idx ON map_suggestions USING gist(geom);
CREATE INDEX map_suggestions_event_status_idx ON map_suggestions(event_id, status);

CREATE TABLE teams (
  id           bigserial PRIMARY KEY,
  event_id     bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  color        text NOT NULL CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  description  text NOT NULL DEFAULT '',
  instructions text NOT NULL DEFAULT '',
  leader_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
  status       text NOT NULL DEFAULT 'non_confirmee' CHECK (status IN ('non_confirmee', 'prete', 'en_mission', 'indisponible')),
  disabled_at  timestamptz,
  version      integer NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, name)
);

-- Points opérationnels retenus par l'organisateur (distincts des suggestions).
CREATE TABLE mission_points (
  id            bigserial PRIMARY KEY,
  event_id      bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  origin        text NOT NULL CHECK (origin IN ('suggestion', 'manuel', 'import')),
  suggestion_id bigint UNIQUE REFERENCES map_suggestions(id) ON DELETE RESTRICT,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  description   text NOT NULL DEFAULT '',
  type          text NOT NULL,
  geom          geometry(Point, 4326) NOT NULL,
  distance_m    double precision,
  -- La distance a été fixée à la main (elle n'est plus recalculée automatiquement).
  distance_locked boolean NOT NULL DEFAULT false,
  version       integer NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    bigint REFERENCES users(id) ON DELETE SET NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CHECK ((origin = 'suggestion') = (suggestion_id IS NOT NULL))
);
CREATE INDEX mission_points_geom_idx ON mission_points USING gist(geom);
CREATE INDEX mission_points_event_idx ON mission_points(event_id) WHERE deleted_at IS NULL;

-- Affectation d'un point à une équipe, dans un ordre défini par l'organisateur.
CREATE TABLE missions (
  id               bigserial PRIMARY KEY,
  event_id         bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  team_id          bigint NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  mission_point_id bigint NOT NULL REFERENCES mission_points(id) ON DELETE RESTRICT,
  position         integer NOT NULL CHECK (position >= 1),
  status           text NOT NULL DEFAULT 'affectee'
                   CHECK (status IN ('a_preparer', 'affectee', 'en_deplacement', 'en_position', 'terminee',
                                     'releve_necessaire', 'incident', 'annulee')),
  instructions     text NOT NULL DEFAULT '',
  version          integer NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  cancelled_at     timestamptz
);
-- Une seule mission active par équipe et par rang ; un point n'est actif qu'une fois par équipe.
CREATE UNIQUE INDEX missions_team_position_idx ON missions(team_id, position) WHERE cancelled_at IS NULL;
CREATE UNIQUE INDEX missions_team_point_idx ON missions(team_id, mission_point_id) WHERE cancelled_at IS NULL;
CREATE INDEX missions_point_idx ON missions(mission_point_id);

CREATE TABLE audit_logs (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  actor_id    bigint REFERENCES users(id) ON DELETE SET NULL,
  event_id    bigint REFERENCES events(id) ON DELETE CASCADE,
  entity      text NOT NULL,
  entity_id   bigint,
  action      text NOT NULL,
  details     jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_logs_entity_idx ON audit_logs(entity, entity_id);
CREATE INDEX audit_logs_event_idx ON audit_logs(event_id, at DESC);
