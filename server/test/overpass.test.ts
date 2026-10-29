import { describe, expect, it } from 'vitest';
import { analyse, mergeOverpass, overpassQueries, type OverpassResponse } from '../src/geo/osm-analysis.js';
import { Route, type Position } from '../src/geo/route.js';
import { OverpassError, overpassFetcher } from '../src/services/overpass.js';
import { at, referenceNetwork } from './helpers/osm.js';

const ok = (body: OverpassResponse) => new Response(JSON.stringify(body), { status: 200 });
const noSleep = async () => {};

describe('découpage des requêtes Overpass', () => {
  it('découpe un long tracé en tronçons qui se chevauchent', () => {
    const seg: Position[] = Array.from({ length: 130 }, (_, i) => at(i * 50, 0));
    const qs = overpassQueries(40, [seg], 60);
    expect(qs).toHaveLength(3);
    // Le dernier sommet d'un tronçon est le premier du suivant.
    const lastOfFirst = seg[59]!;
    const coord = lastOfFirst[1].toFixed(6) + ',' + lastOfFirst[0].toFixed(6);
    expect(qs[0]).toContain(coord);
    expect(qs[1]).toContain(coord);
    expect(qs.every((q) => q.includes('rel(bw.w)["type"="restriction"]'))).toBe(true);
  });

  it('fusionne les réponses sans doublon et garde la date la plus ancienne', () => {
    const full = referenceNetwork();
    const half = Math.floor(full.elements.length / 2);
    const a: OverpassResponse = { osm3s: { timestamp_osm_base: '2026-10-02T00:00:00Z' }, elements: full.elements.slice(0, half + 5) };
    const b: OverpassResponse = { osm3s: { timestamp_osm_base: '2026-10-01T00:00:00Z' }, elements: full.elements.slice(half) };
    const merged = mergeOverpass([a, b]);
    expect(merged.elements).toHaveLength(full.elements.length);
    expect(merged.osm3s?.timestamp_osm_base).toBe('2026-10-01T00:00:00Z');
    // L'analyse du réseau fusionné est identique à celle du réseau complet.
    const route = new Route([[at(0, 3), at(250, -2), at(500, 2)]]);
    expect(analyse(route, merged).suggestions.map((s) => s.stableKey)).toEqual(analyse(route, full).suggestions.map((s) => s.stableKey));
  });
});

describe('client Overpass', () => {
  it('passe au serveur suivant sur un 502', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      return url.includes('a.test') ? new Response('<p><strong>Error</strong>: Gateway</p>', { status: 502 }) : ok({ elements: [] });
    }) as unknown as typeof fetch;
    const f = overpassFetcher(['https://a.test/api', 'https://b.test/api'], 'test', { fetchImpl, sleep: noSleep });
    await expect(f('q')).resolves.toEqual({ elements: [] });
    expect(calls).toEqual(['https://a.test/api', 'https://b.test/api']);
  });

  it('réessaie après une pause, puis explique l’échec', async () => {
    let n = 0;
    const waits: number[] = [];
    const fetchImpl = (async () => {
      n++;
      return new Response('', { status: 504 });
    }) as unknown as typeof fetch;
    const f = overpassFetcher(['https://a.test/api'], 'test', { fetchImpl, rounds: 3, delayMs: 100, sleep: async (ms) => { waits.push(ms); } });
    const err = await f('q').catch((e) => e);
    expect(err).toBeInstanceOf(OverpassError);
    expect(err.message).toMatch(/a\.test : HTTP 504/);
    expect(err.message).toMatch(/réessayez dans quelques minutes/);
    expect(n).toBe(3);
    expect(waits).toEqual([100, 200]);
  });

  it('refuse une réponse tronquée (dépassement de délai côté serveur)', async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      return n === 1 ? ok({ elements: [{ type: 'node', id: 1, lat: 0, lon: 0 }], remark: 'runtime error: Query timed out in "query" at line 3 after 90 seconds.' }) : ok({ elements: [] });
    }) as unknown as typeof fetch;
    const f = overpassFetcher(['https://a.test/api'], 'test', { fetchImpl, sleep: noSleep });
    await expect(f('q')).resolves.toEqual({ elements: [] });
    expect(n).toBe(2);
  });

  it('ne réessaie pas une requête invalide (400)', async () => {
    let n = 0;
    const fetchImpl = (async () => { n++; return new Response('<strong>Error</strong>: line 1: parse error', { status: 400 }); }) as unknown as typeof fetch;
    const f = overpassFetcher(['https://a.test/api', 'https://b.test/api'], 'test', { fetchImpl, sleep: noSleep });
    await expect(f('q')).rejects.toThrow(/Requête refusée.*parse error/);
    expect(n).toBe(1);
  });

  it('serveur injoignable : essaie le suivant', async () => {
    const fetchImpl = (async (url: string) => {
      if (url.includes('a.test')) throw new TypeError('fetch failed');
      return ok({ elements: [] });
    }) as unknown as typeof fetch;
    const f = overpassFetcher(['https://a.test/api', 'https://b.test/api'], 'test', { fetchImpl, sleep: noSleep });
    await expect(f('q')).resolves.toEqual({ elements: [] });
  });
});

describe('client Overpass : réponses vides', () => {
  it('une réponse sans voie fait essayer le serveur suivant', async () => {
    const fetchImpl = (async (url: string) => ok(url.includes('a.test') ? { elements: [] } : { elements: [{ type: 'way', id: 1, nodes: [1, 2] }] })) as unknown as typeof fetch;
    const f = overpassFetcher(['https://a.test/api', 'https://b.test/api'], 'test', { fetchImpl, sleep: noSleep });
    const r = await f('q', { requireWays: true });
    expect(r.elements).toHaveLength(1);
    expect(r.emptyEverywhere).toBeUndefined();
  });

  it('vide partout : réponse vide signalée comme telle', async () => {
    const fetchImpl = (async () => ok({ elements: [] })) as unknown as typeof fetch;
    const f = overpassFetcher(['https://a.test/api'], 'test', { fetchImpl, sleep: noSleep });
    expect(await f('q', { requireWays: true })).toMatchObject({ elements: [], emptyEverywhere: true });
    // Sans exigence, une réponse vide est acceptée telle quelle.
    expect(await f('q')).toEqual({ elements: [] });
  });
});
