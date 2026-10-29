-- Partage de position en direct (facultatif, à l'initiative de chaque membre, si l'organisation l'autorise pour la
-- manifestation). Seule la DERNIÈRE position est conservée — aucun historique — et elle est effacée dès que le
-- membre arrête le partage, quitte l'équipe, ou au plus tard 2 heures après sa dernière mise à jour.
ALTER TABLE events ADD COLUMN location_sharing boolean NOT NULL DEFAULT false;

CREATE TABLE member_locations (
  user_id     bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  event_id    bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  team_id     bigint NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  geom        geometry(Point, 4326) NOT NULL,
  accuracy_m  double precision,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX member_locations_event_idx ON member_locations(event_id, updated_at DESC);
