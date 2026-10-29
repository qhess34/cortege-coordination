// Statut opérationnel d'un point, calculé à partir de ses missions pour rester cohérent avec leur état réel.
export const POINT_STATUS_SQL = `
  CASE
    WHEN EXISTS (SELECT 1 FROM missions m WHERE m.mission_point_id = p.id AND m.cancelled_at IS NULL
                   AND m.status IN ('en_deplacement', 'en_position', 'releve_necessaire', 'incident')) THEN 'mission_en_cours'
    WHEN EXISTS (SELECT 1 FROM missions m WHERE m.mission_point_id = p.id AND m.cancelled_at IS NULL
                   AND m.status IN ('a_preparer', 'affectee')) THEN 'affecte'
    WHEN EXISTS (SELECT 1 FROM missions m WHERE m.mission_point_id = p.id AND m.cancelled_at IS NULL
                   AND m.status = 'terminee') THEN 'mission_terminee'
    ELSE 'valide'
  END`;

export const POINT_STATUSES = ['valide', 'affecte', 'mission_en_cours', 'mission_terminee'] as const;
