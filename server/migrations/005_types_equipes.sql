-- Types d'équipe : points fixes, volante (sans point fixe, intervient sur les incidents), ouverture (tête du
-- cortège) et fermeture (queue du cortège).
ALTER TABLE teams ADD COLUMN kind text NOT NULL DEFAULT 'points'
  CHECK (kind IN ('points', 'volante', 'ouverture', 'fermeture'));

-- La progression déclarée concerne la tête ou la queue du cortège.
ALTER TABLE event_progress ADD COLUMN part text NOT NULL DEFAULT 'tete' CHECK (part IN ('tete', 'queue'));
DROP INDEX event_progress_event_idx;
CREATE INDEX event_progress_event_idx ON event_progress(event_id, part, created_at DESC);
