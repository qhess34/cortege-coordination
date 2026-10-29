import { useEffect, useRef, useState } from 'react';
import { PANORAMAX_API, SEARCH_RADIUS, exploreUrl, findNearestPicture, type NearestPicture } from '../panoramax';
import { dateTime } from '../labels';
import type { Position } from '../types';

interface Props {
  position: Position;
  onClose: () => void;
  /** Photo trouvée (ou null), pour la repérer sur la carte. */
  onPicture: (p: NearestPicture | null) => void;
}

type State = { kind: 'loading' } | { kind: 'none' } | { kind: 'error'; message: string } | { kind: 'ok'; picture: NearestPicture };

/** Bibliothèque chargée à la demande : elle est lourde et inutile tant qu'on n'ouvre pas de photo. */
let viewerLib: Promise<unknown> | null = null;
const loadViewer = () => (viewerLib ??= import('@panoramax/web-viewer'));

export function PanoramaxPanel({ position, onClose, onPicture }: Props) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [ready, setReady] = useState(false);
  const [large, setLarge] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<(HTMLElement & { select?: (seq: string | null, pic: string | null, force?: boolean) => void }) | null>(null);
  const report = useRef(onPicture);
  report.current = onPicture;

  useEffect(() => {
    const ctrl = new AbortController();
    setState({ kind: 'loading' });
    findNearestPicture(position, ctrl.signal).then(
      (picture) => {
        setState(picture ? { kind: 'ok', picture } : { kind: 'none' });
        report.current(picture);
      },
      (e: Error) => {
        if (e.name === 'AbortError') return;
        setState({ kind: 'error', message: e.message });
        report.current(null);
      },
    );
    return () => ctrl.abort();
  }, [position]);

  useEffect(() => {
    if (state.kind !== 'ok' || ready) return;
    loadViewer().then(() => setReady(true), (e: Error) => setState({ kind: 'error', message: 'Viewer indisponible : ' + e.message }));
  }, [state, ready]);

  // Le viewer est créé une fois ; les clics suivants changent seulement la photo affichée.
  // Il lit ses options dans son constructeur : on le crée donc par le parseur HTML, attributs compris
  // (React ou createElement poseraient les attributs trop tard).
  useEffect(() => {
    if (state.kind !== 'ok' || !ready || !host.current) return;
    const { id, sequence } = state.picture;
    if (viewer.current) {
      if (viewer.current.getAttribute('picture') !== id) viewer.current.select?.(sequence, id, true);
      return;
    }
    const attrs: Record<string, string> = {
      class: 'panoramax-viewer', endpoint: PANORAMAX_API, picture: id, lang: 'fr',
      // Le viewer ne doit pas réécrire l'URL : l'application l'utilise pour sa navigation.
      'url-parameters': 'false', 'keyboard-shortcuts': 'false',
      ...(sequence ? { sequence } : {}),
    };
    const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    host.current.innerHTML = '<pnx-photo-viewer ' + Object.entries(attrs).map(([k, v]) => k + '="' + esc(v) + '"').join(' ') + '></pnx-photo-viewer>';
    viewer.current = host.current.firstElementChild as HTMLElement;
  }, [state, ready]);

  return (
    <div className={'panoramax' + (large ? ' large' : '')} data-testid="panoramax">
      <div className="panoramax-head">
        <b className="grow">Photos Panoramax</b>
        <button onClick={() => setLarge(!large)} aria-label={large ? 'Réduire' : 'Agrandir'}>{large ? '⤡' : '⤢'}</button>
        <button onClick={onClose} aria-label="Fermer la vue Panoramax">✕</button>
      </div>
      <div className="panoramax-body">
        {state.kind === 'loading' && <p className="muted">Recherche d’une photo à moins de {SEARCH_RADIUS} m…</p>}
        {state.kind === 'none' && (
          <p className="muted">
            Aucune photo Panoramax à moins de {SEARCH_RADIUS} m de ce point.{' '}
            <a href={'https://explore.panoramax.fr/#focus=map&map=18/' + position[1].toFixed(6) + '/' + position[0].toFixed(6)} target="_blank" rel="noreferrer">Explorer les environs</a>
          </p>
        )}
        {state.kind === 'error' && <p className="error">Photos indisponibles : {state.message}</p>}
        {/* Conteneur du viewer, conservé entre deux recherches pour ne pas recréer le contexte WebGL. */}
        <div ref={host} className="panoramax-host" hidden={state.kind !== 'ok' || !ready} />
        {state.kind === 'ok' && !ready && <p className="muted">Chargement du viewer…</p>}
      </div>
      {state.kind === 'ok' && (
        <div className="panoramax-foot muted">
          Photo © contributeurs Panoramax{state.picture.datetime ? ' · ' + dateTime(state.picture.datetime) : ''} ·{' '}
          <a href={exploreUrl(state.picture.id)} target="_blank" rel="noreferrer">Ouvrir sur Panoramax</a>
        </div>
      )}
    </div>
  );
}
