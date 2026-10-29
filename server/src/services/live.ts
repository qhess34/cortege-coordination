// Temps réel : signale « quelque chose a changé dans cette manifestation » aux écrans abonnés (WebSocket).
// Le signal ne contient aucune donnée : chaque écran recharge ce que ses droits lui permettent de voir.
import { AsyncLocalStorage } from 'node:async_hooks';

/** Manifestations modifiées pendant la requête en cours (alimenté par `audit()`). */
const touched = new AsyncLocalStorage<Set<number>>();

export function runWithTracking(fn: () => void): Set<number> {
  const set = new Set<number>();
  touched.run(set, fn);
  return set;
}

export function markTouched(eventId: number | null): void {
  if (eventId !== null) touched.getStore()?.add(eventId);
}

interface Subscriber { send: (data: string) => void }

export class LiveHub {
  private subs = new Map<number, Set<Subscriber>>();
  private pending = new Map<number, NodeJS.Timeout>();

  constructor(private delayMs = 150) {}

  subscribe(eventId: number, s: Subscriber): () => void {
    let set = this.subs.get(eventId);
    if (!set) this.subs.set(eventId, (set = new Set()));
    set.add(s);
    return () => {
      set.delete(s);
      if (!set.size) this.subs.delete(eventId);
    };
  }

  count(eventId: number): number {
    return this.subs.get(eventId)?.size ?? 0;
  }

  /** Regroupe les modifications rapprochées en un seul signal. */
  publish(eventId: number): void {
    if (!this.subs.has(eventId) || this.pending.has(eventId)) return;
    this.pending.set(eventId, setTimeout(() => {
      this.pending.delete(eventId);
      const msg = JSON.stringify({ type: 'maj', at: new Date().toISOString() });
      for (const s of this.subs.get(eventId) ?? []) {
        try {
          s.send(msg);
        } catch {
          // Connexion fermée entre-temps : elle sera retirée à sa fermeture.
        }
      }
    }, this.delayMs));
  }

  close(): void {
    for (const t of this.pending.values()) clearTimeout(t);
    this.pending.clear();
    this.subs.clear();
  }
}
