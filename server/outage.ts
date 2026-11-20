// SAMPAN_FAKE_OUTAGE: with the fake network only, one provider or part of the page is made to fail, so the e2e
// suite can prove the page never goes blank (e2e/outage.spec.ts). Never active on a real network.
//   indexer  - the Cauldron indexer answers nothing (no pools; health says Cauldron is down)
//   electrum - every Bitcoin Cash server call fails (health says Bitcoin Cash is down)
//   api      - every /api/ path answers 503, /api/config included (what a crashed or unreachable server looks like)
//   chunk    - every script under /assets/ answers 404 (a tab left open across a deploy, or a broken upload)
//   render   - /api/config sends a config the Swap tab cannot draw (a page bug in one tab)
//   app      - /api/config sends a config without its chains, which the page itself reads for the crossing claims (a
//              bug outside every tab)
import type { FastifyInstance } from 'fastify';
import { ChainUnavailableError, type Chain } from './chain/types.js';
import type { FetchActive } from './indexer.js';

export const OUTAGES = ['indexer', 'electrum', 'api', 'chunk', 'render', 'app'] as const;
export type Outage = (typeof OUTAGES)[number];

/** Reads SAMPAN_FAKE_OUTAGE; an unknown value is an error so a typo cannot pass as "no outage". */
export function parseOutage(value: string | undefined): Outage | null {
  if (value === undefined || value === '') return null;
  if (!(OUTAGES as readonly string[]).includes(value)) throw new Error(`SAMPAN_FAKE_OUTAGE must be one of ${OUTAGES.join(', ')}`);
  return value as Outage;
}

/** A chain whose every call fails the way an unreachable Electrum server does. */
export function downChain(): Chain {
  const fail = (): Promise<never> => Promise.reject(new ChainUnavailableError('fake outage: no Bitcoin Cash server answers'));
  return {
    listUnspent: fail,
    historyCount: fail,
    broadcast: fail,
    tipHeight: fail,
    transaction: fail,
    watch: () => () => undefined,
    close: async () => undefined,
  };
}

/** An indexer that never answers. */
export const downIndexer: FetchActive = () => Promise.reject(new Error('fake outage: the Cauldron indexer does not answer'));

/** Request-level outages (api, chunk, render, app). The provider outages are wired in createServices. */
export function registerOutage(app: FastifyInstance, outage: Outage | null): void {
  if (outage === 'api') {
    app.addHook('onRequest', async (request, reply) => {
      if (request.url.startsWith('/api/')) await reply.code(503).send({ error: 'unavailable', message: 'fake outage' });
    });
  }
  if (outage === 'chunk') {
    app.addHook('onRequest', async (request, reply) => {
      if (request.url.startsWith('/assets/') && request.url.split('?')[0]!.endsWith('.js')) {
        await reply.code(404).send({ error: 'not_found' });
      }
    });
  }
  if (outage === 'render') {
    app.addHook('onSend', async (request, _reply, payload) => {
      if (request.url !== '/api/config' || typeof payload !== 'string') return payload;
      return JSON.stringify({ ...(JSON.parse(payload) as object), tokens: {} });
    });
  }
  if (outage === 'app') {
    app.addHook('onSend', async (request, _reply, payload) => {
      if (request.url !== '/api/config' || typeof payload !== 'string') return payload;
      const body = JSON.parse(payload) as Record<string, unknown>;
      delete body.evm;
      return JSON.stringify(body);
    });
  }
}
