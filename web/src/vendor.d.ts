// La bibliothèque Panoramax n'est pas typée : elle enregistre ses éléments personnalisés (pnx-photo-viewer…).
declare module '@panoramax/web-viewer';

interface ImportMetaEnv {
  readonly VITE_TILE_URL?: string;
  readonly VITE_VECTOR_STYLE_URL?: string;
  readonly VITE_PANORAMAX_URL?: string;
  readonly VITE_SATELLITE_URL?: string;
  readonly VITE_SATELLITE_ATTRIBUTION?: string;
}
