// Fonds de carte raster disponibles. Chaque fournisseur a ses conditions d'usage (voir README).
export interface Basemap {
  id: string;
  label: string;
  /** Fond vectoriel : URL d'un style MapLibre (net à tout zoom et sur écran haute densité). */
  style?: string;
  /** Fond raster : modèle d'URL des tuiles. */
  tiles?: string;
  maxzoom: number;
  attribution: string;
}

const env = import.meta.env;
// `||` et non `??` : Docker transmet une chaîne vide quand la variable n'est pas définie.
const IGN_WMTS = 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}';
const IGN_ATTRIBUTION = '© <a href="https://www.ign.fr" target="_blank" rel="noreferrer">IGN</a> – Géoplateforme';

export const BASEMAPS: Basemap[] = [
  {
    id: 'vectoriel',
    label: 'Plan OSM (vectoriel, net)',
    style: env.VITE_VECTOR_STYLE_URL || 'https://tiles.openfreemap.org/styles/liberty',
    maxzoom: 20,
    attribution: '',
  },
  {
    id: 'osm',
    label: 'Plan OSM (images)',
    tiles: env.VITE_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    maxzoom: 19,
    attribution: '© contributeurs <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
  },
  {
    id: 'plan-ign',
    label: 'Plan IGN',
    tiles: IGN_WMTS + '&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&FORMAT=image/png',
    maxzoom: 19,
    attribution: IGN_ATTRIBUTION,
  },
  {
    id: 'ortho-ign',
    label: 'Photo aérienne IGN (France)',
    tiles: IGN_WMTS + '&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&FORMAT=image/jpeg',
    maxzoom: 19,
    attribution: IGN_ATTRIBUTION,
  },
  {
    id: 'satellite',
    label: 'Satellite (Esri, monde)',
    tiles: env.VITE_SATELLITE_URL || 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maxzoom: 19,
    attribution: env.VITE_SATELLITE_ATTRIBUTION || 'Imagerie © Esri, Maxar, Earthstar Geographics',
  },
];

export const DEFAULT_BASEMAP = 'vectoriel';
/** Fond raster utilisé si le style vectoriel ne peut pas être chargé. */
export const FALLBACK_BASEMAP = 'osm';
