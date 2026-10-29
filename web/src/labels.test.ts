import { describe, expect, it } from 'vitest';
import { fieldDescription } from './labels';

describe('description pour le roadbook', () => {
  it('retire les données techniques OSM et garde le texte utile', () => {
    const generated = [
      'Accès entrant : des véhicules peuvent arriver sur le parcours par ici.',
      'Côté nord du carrefour Rue A / Rue B (nœud OSM 3), à 20 m dans la voie.',
      'Voie : Rue B (residential, ouverte aux véhicules, double sens, voie OSM 8936049).',
      'Raccordée : Rue C (residential, ouverte aux véhicules, sens unique, voie OSM 12).',
      'Restriction de tournant no_left_turn (relation OSM 1000).',
      'Barrière Vauban à prévoir.',
    ].join('\n');
    expect(fieldDescription(generated)).toBe('Accès entrant : des véhicules peuvent arriver sur le parcours par ici.\nBarrière Vauban à prévoir.');
    expect(fieldDescription('Point de ralliement')).toBe('Point de ralliement');
  });
});
