// Libellés affichés.
export const SUGGESTION_TYPES: Record<string, string> = {
  carrefour: 'Carrefour',
  rue_laterale: 'Rue latérale (sortante)',
  acces_vehicule_entrant: 'Accès véhicules',
  acces_pieton_cycle: 'Accès piéton / cycle',
  voie_privee: 'Voie privée',
  verification: 'À vérifier',
  point_fixe: 'Point fixe',
  autre: 'Autre',
};
export const SUGGESTION_STATUS: Record<string, string> = { a_examiner: 'À examiner', validee: 'Validée', ecartee: 'Écartée' };
export const POINT_STATUS: Record<string, string> = {
  valide: 'Validé', affecte: 'Affecté', mission_en_cours: 'Mission en cours', mission_terminee: 'Mission terminée',
};
export const MISSION_STATUS: Record<string, string> = {
  a_preparer: 'À préparer', affectee: 'Affectée', en_deplacement: 'En déplacement', en_position: 'En position',
  terminee: 'Terminée', releve_necessaire: 'Relève nécessaire', incident: 'Incident signalé',
};
export const EVENT_STATUS: Record<string, string> = {
  preparation: 'Préparation', pret: 'Prêt', en_cours: 'En cours', termine: 'Terminé', archive: 'Archivé',
};
export const PERTINENCE: Record<string, string> = { elevee: 'Élevée', moyenne: 'Moyenne', faible: 'Faible' };
export const FLOW: Record<string, string> = {
  entrant: 'sens unique vers le parcours', sortant: 'sens unique depuis le parcours', double_sens: 'double sens', variable: 'sens variable',
};
export const MOTOR: Record<string, string> = {
  oui: 'véhicules', limite: 'véhicules (accès limité)', prive: 'privée', non: 'non motorisée', incertain: 'accès incertain',
};
export const MISSION_TRANSITIONS: Record<string, string[]> = {
  a_preparer: ['affectee'],
  affectee: ['a_preparer', 'en_deplacement', 'en_position'],
  en_deplacement: ['affectee', 'en_position', 'incident'],
  en_position: ['terminee', 'releve_necessaire', 'incident'],
  releve_necessaire: ['en_position', 'terminee', 'incident'],
  incident: ['en_deplacement', 'en_position', 'releve_necessaire', 'terminee'],
  terminee: ['affectee'],
};

export const km = (m: number | null | undefined) => (m === null || m === undefined ? '—' : (m / 1000).toFixed(2).replace('.', ',') + ' km');
export const coords = (p: [number, number]) => p[1].toFixed(6) + ', ' + p[0].toFixed(6);
export const dateTime = (s: string | null) => (s ? new Date(s).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

/** Libellé court d'une suggestion : voie concernée, côté de l'accès et voie du cortège. */
export function suggestionPlace(s: { routeNames: string[]; branches: { name: string | null }[]; junction?: { side: string } | null }): string {
  const branch = s.branches[0]?.name ?? 'voie sans nom';
  if (s.junction) return branch + ' côté ' + s.junction.side + (s.routeNames[0] ? ' (' + s.routeNames[0] + ')' : '');
  return (s.routeNames[0] ?? 'voie sans nom') + (s.branches[0]?.name ? ' / ' + s.branches[0].name : '');
}

/**
 * Description lisible sur le terrain : les lignes techniques générées par l'analyse OSM (identifiants, types de
 * voie) sont retirées des descriptions enregistrées avant ce nettoyage.
 */
export function fieldDescription(text: string): string {
  return text
    .split('\n')
    .filter((l) => !/(voie|relation|nœud|nœuds) OSM|^Raccordée :|^Voie :|nœuds OSM regroupés/i.test(l))
    .join('\n')
    .trim();
}

