// Direct : WebSocket qui signale les modifications d'une manifestation ; reconnexion automatique et, en secours,
// rechargement périodique. Le signal ne transporte aucune donnée : l'écran recharge ce dont il a besoin.
import { useEffect, useRef, useState } from 'react';

export interface LiveState {
  /** Connexion directe ouverte. */
  connected: boolean;
  /** Dernière synchronisation réussie (signal ou rechargement). */
  syncedAt: Date | null;
}

export function useLive(
  eventId: number | null, reload: () => Promise<unknown>, pollMs = 30_000,
  /** Appelé au signal « positions » (seules les positions partagées ont changé). */
  onPositions?: () => void,
): LiveState & { markSynced: () => void } {
  const [connected, setConnected] = useState(false);
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const positionsRef = useRef(onPositions);
  positionsRef.current = onPositions;

  useEffect(() => {
    if (eventId === null) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let retry = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let pending: Promise<unknown> | null = null;
    let again = false;

    // Un seul rechargement à la fois ; un signal reçu pendant un rechargement en relance un.
    const refresh = () => {
      if (pending) { again = true; return; }
      pending = reloadRef.current().then(() => setSyncedAt(new Date()), () => undefined).finally(() => {
        pending = null;
        if (again) { again = false; refresh(); }
      });
    };

    const connect = () => {
      if (closed || typeof WebSocket === 'undefined') return;
      const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/direct?event=' + eventId;
      ws = new WebSocket(url);
      ws.onmessage = (e) => {
        try {
          const m = JSON.parse(String(e.data)) as { type: string };
          if (m.type === 'connecte') {
            retry = 0;
            setConnected(true);
            refresh(); // rattrape ce qui a pu changer pendant la coupure
          } else if (m.type === 'maj') refresh();
          else if (m.type === 'positions') positionsRef.current?.();
        } catch {
          // message illisible : ignoré
        }
      };
      ws.onclose = (e) => {
        setConnected(false);
        ws = null;
        if (closed || e.code === 4404) return;
        retry = Math.min(retry + 1, 6);
        retryTimer = setTimeout(connect, 1000 * 2 ** (retry - 1));
      };
    };
    connect();
    const poll = setInterval(() => { if (!ws || ws.readyState !== WebSocket.OPEN) refresh(); }, pollMs);
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', refresh);
    return () => {
      closed = true;
      clearTimeout(retryTimer);
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', refresh);
      ws?.close();
    };
  }, [eventId, pollMs]);

  return { connected, syncedAt, markSynced: () => setSyncedAt(new Date()) };
}

/** « à l'instant », « il y a 3 min »… */
export function ago(d: Date | string | null, now = Date.now()): string {
  if (!d) return '—';
  const s = Math.max(0, Math.round((now - new Date(d).getTime()) / 1000));
  if (s < 45) return 'à l’instant';
  if (s < 3600) return 'il y a ' + Math.round(s / 60) + ' min';
  if (s < 86400) return 'il y a ' + Math.floor(s / 3600) + ' h ' + String(Math.round((s % 3600) / 60)).padStart(2, '0');
  return new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}
