-- Schéma de la base : comptes, sessions et liens de connexion ; manifestations, parcours, analyses OSM, suggestions,
-- carrefours, points, équipes, missions ; coordination du jour J (messages, SOS, progression, positions, OwnTracks) ;
-- journal d'audit.

CREATE EXTENSION IF NOT EXISTS postgis;

-- Comptes créés uniquement par un administrateur (aucune inscription publique). Un compte « membre » (membre d'équipe)
-- n'a ni identifiant ni mot de passe : il se connecte par lien et ne voit que ses équipes. Un compte avec une date
-- d'expiration est supprimé automatiquement à cette date.
CREATE TABLE users (
  id            bigserial PRIMARY KEY,
  login         text UNIQUE CHECK (login ~ '^[a-z0-9._-]{3,64}$'),
  display_name  text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
  first_name    text NOT NULL DEFAULT '' CHECK (length(first_name) <= 80),
  last_name     text NOT NULL DEFAULT '' CHECK (length(last_name) <= 80),
  email         text,
  -- Téléphone (facultatif), pour joindre la personne le jour J ; chiffres et « + » initial seulement.
  phone         text CONSTRAINT users_phone_check CHECK (phone ~ '^\+?[0-9]{6,20}$'),
  password_hash text,
  global_role   text NOT NULL DEFAULT 'membre' CHECK (global_role IN ('admin', 'organisateur', 'membre', 'aucun')),
  expires_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    bigint REFERENCES users(id) ON DELETE SET NULL,
  disabled_at   timestamptz,
  -- Seuls les membres se passent d'identifiant (connexion par lien uniquement).
  CONSTRAINT users_login_required_check CHECK (login IS NOT NULL OR global_role = 'membre')
);
CREATE UNIQUE INDEX users_email_idx ON users (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX users_expires_idx ON users(expires_at) WHERE expires_at IS NOT NULL;

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
  -- Partage de position en direct autorisé (chaque membre décide ensuite s'il partage).
  location_sharing boolean NOT NULL DEFAULT false,
  -- Rayon (m) des zones envoyées à OwnTracks autour des points de mission (détection d'arrivée).
  zone_radius_m    integer NOT NULL DEFAULT 50 CHECK (zone_radius_m BETWEEN 20 AND 300),
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
  -- Rues nommées relevées (voies et nœuds) : nom d'un nouveau point d'après la rue ou le croisement.
  streets        jsonb,
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
  -- Les responsables peuvent ajouter et retirer des membres de leur équipe.
  leader_can_manage boolean NOT NULL DEFAULT false,
  -- Points fixes, volante (SOS et relèves), ouverture (tête du cortège), fermeture (queue).
  kind         text NOT NULL DEFAULT 'points' CHECK (kind IN ('points', 'volante', 'ouverture', 'fermeture')),
  status       text NOT NULL DEFAULT 'non_confirmee' CHECK (status IN ('non_confirmee', 'prete', 'en_mission', 'indisponible')),
  disabled_at  timestamptz,
  version      integer NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, name)
);

-- Membres d'une équipe (comptes « membre » ou comptes d'organisation ayant accès à la manifestation).
CREATE TABLE team_memberships (
  team_id    bigint NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'membre' CHECK (role IN ('membre', 'responsable')),
  joined_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX team_memberships_user_idx ON team_memberships(user_id);

-- Carrefours : regroupement des points d'un même carrefour (un point par accès) pour l'export GPX et le suivi.
-- Chaque point reste un point de mission à part entière ; le carrefour ne sert qu'à les présenter ensemble.
CREATE TABLE places (
  id          bigserial PRIMARY KEY,
  event_id    bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  -- Carrefour OSM d'origine (regroupement automatique à la validation des suggestions), sinon NULL (regroupement manuel).
  osm_node    bigint,
  -- Centre : le carrefour, ou le barycentre des points regroupés à la main.
  geom        geometry(Point, 4326) NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, osm_node)
);
CREATE INDEX places_event_idx ON places(event_id);

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
  -- Carrefour regroupant ce point avec d'autres accès.
  place_id      bigint REFERENCES places(id) ON DELETE SET NULL,
  CHECK ((origin = 'suggestion') = (suggestion_id IS NOT NULL))
);
CREATE INDEX mission_points_geom_idx ON mission_points USING gist(geom);
CREATE INDEX mission_points_place_idx ON mission_points(place_id);
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
                                     'releve_necessaire', 'annulee')),
  instructions     text NOT NULL DEFAULT '',
  version          integer NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  cancelled_at     timestamptz,
  -- Dernier changement de statut (affiché au tableau de bord).
  status_changed_at timestamptz,
  status_changed_by bigint REFERENCES users(id) ON DELETE SET NULL
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

-- --- Connexion par lien --------------------------------------------------------------------------------------------

-- Liens de connexion à usage unique : QR code d'un appareil connecté, lien d'un administrateur (dont l'activation d'un
-- membre), lien envoyé par l'organisation d'une équipe, lien par e-mail. Seul le hash du jeton est stocké.
CREATE TABLE login_links (
  id          bigserial PRIMARY KEY,
  token_hash  bytea NOT NULL UNIQUE,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('appareil', 'admin', 'email', 'equipe')),
  created_by  bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);
CREATE INDEX login_links_user_idx ON login_links(user_id);

-- --- Coordination du jour J ------------------------------------------------------------------------------------------

-- Messages : fil d'une équipe avec l'organisation (team_id renseigné) ou annonce à tous (team_id NULL).
CREATE TABLE messages (
  id          bigserial PRIMARY KEY,
  event_id    bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  team_id     bigint REFERENCES teams(id) ON DELETE CASCADE,
  author_id   bigint REFERENCES users(id) ON DELETE SET NULL,
  body        text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  urgent      boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_event_idx ON messages(event_id, created_at DESC);
CREATE INDEX messages_team_idx ON messages(team_id, created_at DESC);

-- Accusés de lecture.
CREATE TABLE message_receipts (
  message_id  bigint NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

-- Types de SOS, propres à chaque manifestation et modifiables par l'organisation (4 types créés avec chaque
-- manifestation, voir routes/events.ts).
CREATE TABLE sos_types (
  id          bigserial PRIMARY KEY,
  event_id    bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  label       text NOT NULL CHECK (length(label) BETWEEN 1 AND 60),
  position    integer NOT NULL DEFAULT 1 CHECK (position >= 1),
  archived_at timestamptz
);
CREATE INDEX sos_types_event_idx ON sos_types(event_id);

-- SOS signalés depuis le terrain : un type et un texte facultatif ; ouvert, puis résolu. type_label est une copie du
-- libellé au moment du signalement (lisible même si le type est renommé ou retiré). Lieu : geom si fourni, sinon le
-- point de la mission.
CREATE TABLE sos (
  id           bigserial PRIMARY KEY,
  event_id     bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  team_id      bigint REFERENCES teams(id) ON DELETE SET NULL,
  mission_id   bigint REFERENCES missions(id) ON DELETE SET NULL,
  reporter_id  bigint REFERENCES users(id) ON DELETE SET NULL,
  type_id      bigint REFERENCES sos_types(id) ON DELETE SET NULL,
  type_label   text NOT NULL CHECK (length(type_label) BETWEEN 1 AND 60),
  message      text NOT NULL DEFAULT '' CHECK (length(message) <= 1000),
  geom         geometry(Point, 4326),
  handled_by   bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  version      integer NOT NULL DEFAULT 1
);
CREATE INDEX sos_event_idx ON sos(event_id, resolved_at);

-- Progression de la tête ou de la queue du cortège (distance sur le parcours) : déclarée, ou calculée à partir des
-- positions partagées de l'ouverture et de la fermeture (sans auteur ni coordonnées).
CREATE TABLE event_progress (
  id          bigserial PRIMARY KEY,
  event_id    bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  part        text NOT NULL DEFAULT 'tete' CHECK (part IN ('tete', 'queue')),
  distance_m  double precision NOT NULL CHECK (distance_m >= 0),
  note        text NOT NULL DEFAULT '',
  author_id   bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX event_progress_event_idx ON event_progress(event_id, part, created_at DESC);

-- Partage de position en direct (facultatif) : seule la DERNIÈRE position d'un membre est conservée, sans historique,
-- effacée à l'arrêt du partage, au retrait de l'équipe, et au plus tard 2 heures après sa dernière mise à jour.
CREATE TABLE member_locations (
  user_id     bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  event_id    bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  team_id     bigint NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  geom        geometry(Point, 4326) NOT NULL,
  accuracy_m  double precision,
  source      text NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'owntracks')),
  battery     integer,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX member_locations_event_idx ON member_locations(event_id, updated_at DESC);

-- Suivi en arrière-plan avec l'application OwnTracks : un identifiant de suivi par membre ; seul le hash du secret
-- est stocké. Expire le lendemain de la manifestation, révocable.
CREATE TABLE trackers (
  id                 text PRIMARY KEY,
  secret_hash        bytea NOT NULL,
  user_id            bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id            bigint NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  event_id           bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz,
  -- Dernier contact de l'application, niveau de batterie et version des zones (points de mission) envoyées.
  last_seen_at       timestamptz,
  battery            integer,
  waypoints_version  text
);
CREATE INDEX trackers_user_idx ON trackers(user_id);
CREATE INDEX trackers_event_idx ON trackers(event_id);
