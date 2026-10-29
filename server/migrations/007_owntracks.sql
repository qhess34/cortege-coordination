-- Suivi en arrière-plan avec l'application OwnTracks (mode HTTP). Un identifiant de suivi par membre et par
-- manifestation ; seul le hash du secret est stocké. Expire le lendemain de la manifestation, révocable.
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

-- Origine de la position partagée (navigateur ou OwnTracks) et batterie, pour l'organisation.
ALTER TABLE member_locations ADD COLUMN source text NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'owntracks'));
ALTER TABLE member_locations ADD COLUMN battery integer;

-- Rayon (m) des zones envoyées à OwnTracks autour des points de mission (détection d'arrivée en arrière-plan).
ALTER TABLE events ADD COLUMN zone_radius_m integer NOT NULL DEFAULT 50 CHECK (zone_radius_m BETWEEN 20 AND 300);
