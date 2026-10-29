-- Lot 3 : coordination le jour J (messages, incidents, progression déclarée du cortège).

-- Qui a changé le statut d'une mission en dernier, et quand (affiché au tableau de bord).
ALTER TABLE missions ADD COLUMN status_changed_at timestamptz;
ALTER TABLE missions ADD COLUMN status_changed_by bigint REFERENCES users(id) ON DELETE SET NULL;

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

-- Incidents signalés depuis le terrain (ou par l'organisation).
CREATE TABLE incidents (
  id           bigserial PRIMARY KEY,
  event_id     bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  team_id      bigint REFERENCES teams(id) ON DELETE SET NULL,
  mission_id   bigint REFERENCES missions(id) ON DELETE SET NULL,
  reporter_id  bigint REFERENCES users(id) ON DELETE SET NULL,
  category     text NOT NULL CHECK (category IN ('aide', 'securite', 'sante', 'circulation', 'materiel', 'autre')),
  priority     text NOT NULL DEFAULT 'normale' CHECK (priority IN ('normale', 'haute')),
  status       text NOT NULL DEFAULT 'ouvert' CHECK (status IN ('ouvert', 'pris_en_charge', 'resolu')),
  description  text NOT NULL DEFAULT '',
  geom         geometry(Point, 4326),
  handled_by   bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  version      integer NOT NULL DEFAULT 1
);
CREATE INDEX incidents_event_idx ON incidents(event_id, status);

-- Progression déclarée de la tête du cortège (distance cumulée sur le parcours). Ce n'est jamais une position GPS.
CREATE TABLE event_progress (
  id          bigserial PRIMARY KEY,
  event_id    bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  distance_m  double precision NOT NULL CHECK (distance_m >= 0),
  note        text NOT NULL DEFAULT '',
  author_id   bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX event_progress_event_idx ON event_progress(event_id, created_at DESC);
