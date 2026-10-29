import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { bearing } from '../../../server/src/geo/route';
import { PANORAMAX_API, SEARCH_RADIUS, exploreUrl, findNearestPicture, type NearestPicture } from '../panoramax';
import { dateTime } from '../labels';
import type { Position } from '../types';

interface Props {
  position: Position;
  onClose: () => void;
  /** Photo trouvée (ou null), pour la repérer sur la carte. */
  onPicture: (p: NearestPicture | null) => void;
  /** Photo affichée et direction regardée (0° = nord, sens horaire), pour la boussole de la carte. */
  onView?: (v: { position: Position; heading: number }) => void;
}

type State = { kind: 'loading' } | { kind: 'none' } | { kind: 'error'; message: string } | { kind: 'ok'; picture: NearestPicture };

/** Bibliothèque chargée à la demande : elle est lourde et inutile tant qu'on n'ouvre pas de photo. */
let viewerLib: Promise<unknown> | null = null;
const loadViewer = () => (viewerLib ??= import('@panoramax/web-viewer'));

/**
 * Position du panneau choisie par l'utilisateur, en fractions de l'espace libre (0 = bord gauche/haut, 1 = bord
 * droit/bas) : elle reste valable si la fenêtre change de taille. Simple confort, mémorisé dans le navigateur.
 */
type PanelPosition = { x: number; y: number };
const POSITION_PREF = 'cortege.panoramax.position';
function readPosition(): PanelPosition | null {
  try {
    const v = JSON.parse(localStorage.getItem(POSITION_PREF) ?? 'null') as PanelPosition | null;
    return v && Number.isFinite(v.x) && Number.isFinite(v.y) ? v : null;
  } catch {
    return null;
  }
}
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Rend le panneau déplaçable par sa barre de titre, à l'intérieur de son conteneur. */
function useDraggablePanel(disabled: boolean) {
  const root = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<PanelPosition | null>(readPosition);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  const apply = useCallback((p: PanelPosition | null) => {
    const el = root.current;
    const parent = el?.offsetParent as HTMLElement | null;
    if (!el || !parent) return;
    if (!p || disabled) {
      el.style.left = el.style.top = el.style.right = el.style.bottom = '';
      return;
    }
    el.style.right = el.style.bottom = 'auto';
    el.style.left = Math.round(p.x * Math.max(0, parent.clientWidth - el.offsetWidth)) + 'px';
    el.style.top = Math.round(p.y * Math.max(0, parent.clientHeight - el.offsetHeight)) + 'px';
  }, [disabled]);

  useLayoutEffect(() => apply(pos), [pos, apply]);
  useEffect(() => {
    const parent = root.current?.offsetParent;
    if (!parent) return;
    const ro = new ResizeObserver(() => apply(pos));
    ro.observe(parent);
    return () => ro.disconnect();
  }, [pos, apply]);

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    const el = root.current;
    if (disabled || !el || e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { dx: e.clientX - el.offsetLeft, dy: e.clientY - el.offsetTop };
  };
  const toFraction = (e: ReactPointerEvent<HTMLElement>): PanelPosition | null => {
    const el = root.current;
    const parent = el?.offsetParent as HTMLElement | null;
    if (!el || !parent || !drag.current) return null;
    const freeX = Math.max(1, parent.clientWidth - el.offsetWidth);
    const freeY = Math.max(1, parent.clientHeight - el.offsetHeight);
    return { x: clamp01((e.clientX - drag.current.dx) / freeX), y: clamp01((e.clientY - drag.current.dy) / freeY) };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const p = toFraction(e);
    if (p) apply(p);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    const p = toFraction(e);
    drag.current = null;
    if (!p) return;
    setPos(p);
    try { localStorage.setItem(POSITION_PREF, JSON.stringify(p)); } catch { /* préférence non mémorisée */ }
  };
  // Double-clic sur la barre : retour à la position par défaut.
  const onDoubleClick = (e: ReactMouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    setPos(null);
    try { localStorage.removeItem(POSITION_PREF); } catch { /* préférence non mémorisée */ }
  };
  return { root, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onDoubleClick } };
}

export function PanoramaxPanel({ position, onClose, onPicture, onView }: Props) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [ready, setReady] = useState(false);
  const [large, setLarge] = useState(false);
  const { root, handlers } = useDraggablePanel(large);
  const host = useRef<HTMLDivElement>(null);
  const orientPending = useRef(false);
  const clicked = useRef(position);
  clicked.current = position;
  const viewRef = useRef(onView);
  viewRef.current = onView;
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
      if (viewer.current.getAttribute('picture') !== id) {
        orientPending.current = true;
        viewer.current.select?.(sequence, id, true);
      }
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
    orientPending.current = true;
    // Boussole : position de la photo et direction regardée, à chaque photo et à chaque rotation.
    const el = viewer.current as HTMLElement & { psv?: { setXYZ?: (x: number, y: number, z: number) => void; getXYZ?: () => { z: number } } };
    let photoPos: Position | null = null;
    el.addEventListener('psv:picture-loaded', (ev) => {
      const d = (ev as CustomEvent<{ lon?: number; lat?: number; x?: number }>).detail;
      if (typeof d.lon !== 'number' || typeof d.lat !== 'number') return;
      photoPos = [d.lon, d.lat];
      let heading = d.x ?? 0;
      // Photo chargée suite à un clic sur la carte : on tourne la vue vers l'endroit cliqué.
      const target = clicked.current;
      if (orientPending.current && target && (Math.abs(target[0] - d.lon) > 1e-6 || Math.abs(target[1] - d.lat) > 1e-6)) {
        heading = bearing(photoPos, target);
        try {
          el.psv?.setXYZ?.(heading, 0, el.psv.getXYZ?.().z ?? 0);
        } catch {
          // Visionneuse pas encore prête : la vue garde son orientation d'origine.
          heading = d.x ?? 0;
        }
      }
      orientPending.current = false;
      viewRef.current?.({ position: photoPos, heading });
    });
    el.addEventListener('psv:view-rotated', (ev) => {
      const d = (ev as CustomEvent<{ x?: number }>).detail;
      if (photoPos && typeof d.x === 'number') viewRef.current?.({ position: photoPos, heading: ((d.x % 360) + 360) % 360 });
    });
  }, [state, ready]);

  return (
    <div ref={root} className={'panoramax' + (large ? ' large' : '')} data-testid="panoramax">
      <div className="panoramax-head" {...handlers} title={large ? undefined : 'Glisser pour déplacer · double-clic pour replacer'}>
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
