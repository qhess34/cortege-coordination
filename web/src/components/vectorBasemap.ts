// Chargement d'un fond vectoriel (style MapLibre externe) sous les couches de l'application, sans remplacer
// le style de la carte : les sources et couches du style sont ajoutées avec un préfixe.
import type { LayerSpecification, Map as MlMap, SourceSpecification, StyleSpecification } from 'maplibre-gl';

export const VECTOR_PREFIX = 'vec-';

/** Charge le style et renvoie les identifiants des couches ajoutées. */
export async function loadVectorBasemap(map: MlMap, styleUrl: string, beforeId: string, timeoutMs = 10_000): Promise<string[]> {
  const res = await fetch(styleUrl, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const style = (await res.json()) as StyleSpecification;
  if (!style || !Array.isArray(style.layers) || !style.sources) throw new Error('style invalide');

  if (style.glyphs) map.setGlyphs(style.glyphs);
  if (typeof style.sprite === 'string') map.setSprite(style.sprite);
  else if (Array.isArray(style.sprite)) for (const s of style.sprite) map.addSprite(s.id, s.url);

  for (const [id, src] of Object.entries(style.sources)) {
    if (!map.getSource(VECTOR_PREFIX + id)) map.addSource(VECTOR_PREFIX + id, src as SourceSpecification);
  }
  const ids: string[] = [];
  for (const layer of style.layers) {
    const id = VECTOR_PREFIX + layer.id;
    if (map.getLayer(id)) {
      ids.push(id);
      continue;
    }
    const copy = { ...layer, id } as LayerSpecification & { source?: string };
    if ('source' in layer && typeof layer.source === 'string') copy.source = VECTOR_PREFIX + layer.source;
    map.addLayer(copy, map.getLayer(beforeId) ? beforeId : undefined);
    // Les couches masquées dans le style d'origine le restent.
    if (layer.layout && 'visibility' in layer.layout && layer.layout.visibility === 'none') continue;
    ids.push(id);
  }
  return ids;
}
