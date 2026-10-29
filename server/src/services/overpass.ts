// Client Overpass : plusieurs serveurs possibles, réessais sur les erreurs passagères, délai maximal,
// identification du client, et refus des réponses tronquées.
import type { OverpassResponse } from '../geo/osm-analysis.js';

export type OsmFetcher = (query: string) => Promise<OverpassResponse>;

export class OverpassError extends Error {}

/** Codes HTTP passagers : serveur saturé ou requête interrompue côté serveur. */
const RETRYABLE = new Set([429, 502, 503, 504]);

export interface OverpassOptions {
  timeoutMs?: number;
  /** Nombre de tours sur la liste des serveurs. */
  rounds?: number;
  /** Attente avant le tour n (multipliée par n), en ms. */
  delayMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** Extrait le message d'erreur d'une page d'erreur Overpass (HTML) sans en recopier tout le contenu. */
function overpassMessage(body: string): string {
  const m = body.match(/<strong[^>]*>\s*Error\s*<\/strong>\s*:?\s*([^<]{1,300})/i) ?? body.match(/runtime error:?\s*([^<\n]{1,300})/i);
  return m ? m[1]!.trim() : '';
}

export function overpassFetcher(urls: string[], userAgent: string, opts: OverpassOptions = {}): OsmFetcher {
  const { timeoutMs = 120_000, rounds = 2, delayMs = 5_000, fetchImpl = fetch } = opts;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  if (!urls.length) throw new Error('Aucun serveur Overpass configuré (OVERPASS_URL).');

  return async (query) => {
    const failures: string[] = [];
    for (let round = 0; round < rounds; round++) {
      if (round > 0) await sleep(delayMs * round);
      for (const url of urls) {
        let res: Response;
        try {
          res = await fetchImpl(url, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': userAgent },
            body: new URLSearchParams({ data: query }).toString(),
            signal: AbortSignal.timeout(timeoutMs),
          });
        } catch (e) {
          const name = (e as Error).name;
          failures.push(host(url) + ' : ' + (name === 'TimeoutError' || name === 'AbortError' ? 'délai dépassé' : 'injoignable'));
          continue;
        }
        if (!res.ok) {
          const detail = overpassMessage(await res.text().catch(() => ''));
          failures.push(host(url) + ' : HTTP ' + res.status + (detail ? ' (' + detail + ')' : ''));
          // Erreur de requête (400…) : inutile d'insister ailleurs, la requête elle-même est en cause.
          if (!RETRYABLE.has(res.status)) throw new OverpassError('Requête refusée par Overpass : ' + failures[failures.length - 1] + '.');
          continue;
        }
        let json: OverpassResponse;
        try {
          json = (await res.json()) as OverpassResponse;
        } catch {
          failures.push(host(url) + ' : réponse illisible');
          continue;
        }
        if (!Array.isArray(json.elements)) {
          failures.push(host(url) + ' : réponse inattendue');
          continue;
        }
        // Délai ou mémoire dépassés en cours de route : Overpass répond 200 avec des données partielles.
        if (json.remark && /error/i.test(json.remark)) {
          failures.push(host(url) + ' : réponse incomplète (' + json.remark.slice(0, 200) + ')');
          continue;
        }
        return json;
      }
    }
    throw new OverpassError(
      'Aucun serveur Overpass n’a fourni de données complètes (' + failures.join(' ; ') + '). ' +
        'Les serveurs publics sont probablement surchargés : réessayez dans quelques minutes, ou configurez ' +
        'un autre serveur (OVERPASS_URL).',
    );
  };
}
