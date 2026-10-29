// Menu affiché au clic sur la carte (hors point et suggestion).
import { useEffect, useState } from 'react';
import { coords, km } from '../labels';
import type { Position } from '../types';

interface Props {
  position: Position;
  /** Distance cumulée sur le parcours et écart au tracé, si un parcours est importé. */
  onRoute: { distance: number; offset: number } | null;
  canEdit: boolean;
  onPhotos: () => void;
  onAddPoint: () => void;
  onClose: () => void;
}

export function MapMenu({ position, onRoute, canEdit, onPhotos, onAddPoint, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const [copied, setCopied] = useState<'ok' | 'impossible' | null>(null);
  // Le presse-papiers n'est accessible qu'en HTTPS (ou en local) : on le dit plutôt que d'échouer en silence.
  const copy = () => {
    const text = position[1].toFixed(6) + ', ' + position[0].toFixed(6);
    if (!navigator.clipboard) return setCopied('impossible');
    navigator.clipboard.writeText(text).then(() => setCopied('ok'), () => setCopied('impossible'));
  };

  return (
    <div className="map-menu" role="menu" data-testid="map-menu">
      <div className="row">
        <span className="muted small grow">
          {coords(position)}
          {onRoute ? <><br />{km(onRoute.distance)} sur le parcours, à {Math.round(onRoute.offset)} m du tracé</> : null}
        </span>
        <button type="button" className="link" onClick={onClose} aria-label="Fermer le menu">✕</button>
      </div>
      <button type="button" role="menuitem" onClick={onPhotos}>📷 Voir les photos ici (Panoramax)</button>
      {canEdit && <button type="button" role="menuitem" onClick={onAddPoint}>📍 Ajouter un point ici</button>}
      <button type="button" role="menuitem" onClick={copy}>Copier les coordonnées</button>
      {copied === 'ok' && <p className="small" role="status">Coordonnées copiées.</p>}
      {copied === 'impossible' && <p className="small" role="status">Copie impossible ici : sélectionnez les coordonnées ci-dessus.</p>}
    </div>
  );
}
