// Partage de position en direct depuis le téléphone, à l'initiative du membre. Fonctionne tant que l'application est
// ouverte à l'écran (une application web ne peut pas suivre la position en arrière-plan) ; l'écran est gardé allumé
// pendant le partage quand le navigateur le permet.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../api';
import type { Position } from '../types';

const PREF = 'cortege.partage';
/** Envoi au plus toutes les MIN_INTERVAL ms, sauf déplacement de plus de MIN_MOVE m. */
const MIN_INTERVAL = 15_000;
const MIN_MOVE = 25;

const metersBetween = (a: Position, b: Position) => {
  const k = Math.PI / 180;
  const x = (b[0] - a[0]) * k * Math.cos(((a[1] + b[1]) / 2) * k);
  const y = (b[1] - a[1]) * k;
  return Math.hypot(x, y) * 6_371_000;
};

const readPref = () => { try { return localStorage.getItem(PREF); } catch { return null; } };
const writePref = (v: string | null) => {
  try { if (v === null) localStorage.removeItem(PREF); else localStorage.setItem(PREF, v); } catch { /* préférence non mémorisée */ }
};

interface WakeLockSentinelLike { release: () => Promise<void> }

export function useSharing(opts: {
  teamId: number;
  allowed: boolean;
  onPosition: (p: Position) => void;
  onArrived: (pointName: string) => void;
  onError: (text: string) => void;
}) {
  const [on, setOn] = useState(false);
  const [lastSent, setLastSent] = useState<Date | null>(null);
  const watch = useRef<number | null>(null);
  const sent = useRef<{ at: number; pos: Position } | null>(null);
  const wake = useRef<WakeLockSentinelLike | null>(null);
  const cb = useRef(opts);
  cb.current = opts;

  const keepAwake = useCallback(async () => {
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinelLike> } };
    try { wake.current = (await nav.wakeLock?.request('screen')) ?? null; } catch { wake.current = null; }
  }, []);

  const halt = useCallback(() => {
    if (watch.current !== null) navigator.geolocation?.clearWatch(watch.current);
    watch.current = null;
    sent.current = null;
    void wake.current?.release().catch(() => undefined);
    wake.current = null;
    setOn(false);
  }, []);

  const send = useCallback(async (pos: Position, accuracy: number | null) => {
    const now = Date.now();
    const prev = sent.current;
    if (prev && now - prev.at < MIN_INTERVAL && metersBetween(prev.pos, pos) < MIN_MOVE) return;
    sent.current = { at: now, pos };
    try {
      const r = await api.post<{ arrived: { pointName: string } | null }>('/api/terrain/equipes/' + cb.current.teamId + '/position', { position: pos, accuracy });
      setLastSent(new Date());
      if (r.arrived) cb.current.onArrived(r.arrived.pointName);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 409 || e.status === 403 || e.status === 404)) {
        halt();
        writePref(null);
        cb.current.onError(e.message);
      }
      // Erreur réseau passagère : le prochain relevé réessaiera.
    }
  }, [halt]);

  const start = useCallback(() => {
    if (!navigator.geolocation) { cb.current.onError('Position indisponible sur cet appareil.'); return; }
    if (watch.current !== null) return;
    watch.current = navigator.geolocation.watchPosition(
      (p) => {
        const pos: Position = [p.coords.longitude, p.coords.latitude];
        cb.current.onPosition(pos);
        void send(pos, Number.isFinite(p.coords.accuracy) ? Math.round(p.coords.accuracy) : null);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          halt();
          writePref(null);
          cb.current.onError('Position refusée : autorisez la localisation pour ce site dans les réglages du navigateur.');
        }
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
    );
    writePref(String(cb.current.teamId));
    setOn(true);
    void keepAwake();
  }, [send, halt, keepAwake]);

  const stop = useCallback(async () => {
    halt();
    writePref(null);
    await api.delete('/api/terrain/position').catch(() => undefined);
  }, [halt]);

  // Reprise automatique si le membre partageait déjà sa position sur cet appareil ; arrêt si l'organisation désactive.
  useEffect(() => {
    if (opts.allowed && readPref() === String(opts.teamId)) start();
    if (!opts.allowed) halt();
  }, [opts.allowed, opts.teamId, start, halt]);

  // Le verrou d'écran est perdu quand l'application passe en arrière-plan : on le reprend au retour.
  useEffect(() => {
    const f = () => { if (document.visibilityState === 'visible' && watch.current !== null) void keepAwake(); };
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, [keepAwake]);

  useEffect(() => () => {
    if (watch.current !== null) navigator.geolocation?.clearWatch(watch.current);
    void wake.current?.release().catch(() => undefined);
  }, []);

  return { on, lastSent, start, stop };
}
