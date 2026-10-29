import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('client API', () => {
  it("envoie l'en-tête anti-CSRF et le cookie de session du navigateur", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await api.post('/api/x', { a: 1 });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.headers['x-requested-with']).toBe('cortege');
    expect(init.credentials).toBe('same-origin');
    expect(init.body).toBe('{"a":1}');
  });

  it('transforme une réponse en erreur explicite avec ses détails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":"Conflit","details":{"missions":[1]}}', { status: 409 })));
    const err = await api.delete('/api/points/1').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, message: 'Conflit', details: { missions: [1] } });
  });
});
