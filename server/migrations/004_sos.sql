-- 004 : remplace les « incidents » par des « SOS ».
-- Un SOS = un type (liste configurable par l'organisation) + un texte facultatif. Plus simple que les
-- incidents (ni catégories figées, ni priorité, ni « pris en charge ») : ouvert, puis résolu.

DROP TABLE IF EXISTS incidents CASCADE;

-- Types de SOS, propres à chaque manifestation et modifiables par l'organisation.
CREATE TABLE sos_types (
  id          bigserial PRIMARY KEY,
  event_id    bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  label       text NOT NULL CHECK (length(label) BETWEEN 1 AND 60),
  position    integer NOT NULL DEFAULT 1 CHECK (position >= 1),
  archived_at timestamptz
);
CREATE INDEX sos_types_event_idx ON sos_types(event_id);

-- Signalements SOS. type_label est une copie du libellé au moment du signalement : le SOS reste lisible
-- même si le type est ensuite renommé ou retiré. Lieu : geom si fourni, sinon le point de la mission.
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

-- Types par défaut pour les manifestations existantes (les nouvelles sont créées avec les mêmes, voir routes/events.ts).
INSERT INTO sos_types(event_id, label, position)
SELECT e.id, d.label, d.position
  FROM events e
  CROSS JOIN (VALUES ('Besoin de renforts', 1), ('Besoin de secours', 2), ('Agression', 3), ('Problème / blocage', 4)) AS d(label, position);
