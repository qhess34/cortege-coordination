// Limite de débit des liens d'invitation : empêche d'essayer des jetons en masse.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Agent, setup, type TestContext } from './helpers/app.js';

let ctx: TestContext;
beforeAll(async () => { ctx = await setup({ joinRateLimit: 3 }); });
afterAll(() => ctx.close());

it("bloque l'essai massif de jetons depuis une même adresse", async () => {
  const a = new Agent(ctx.app);
  const codes = [];
  for (let i = 0; i < 4; i++) codes.push((await a.get('/api/rejoindre/inconnu' + i)).statusCode);
  expect(codes).toEqual([404, 404, 404, 429]);
});
