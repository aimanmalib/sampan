// Electrum (Fulcrum) client with failover across config.electrum.servers. One connection at a time; a failed
// request moves to the next server and is retried once there. Responses keep amounts exact (BigInt).
import { binToHex, hexToBin, sha256 } from '@bitauth/libauth';
import { ElectrumClient, type ElectrumClientEvents } from '@electrum-cash/network';
import { BroadcastError, ChainUnavailableError, type Chain, type ChainUtxo } from './types.js';

/** Electrum addresses scripts by the reversed sha256 of the locking bytecode. */
export const scriptHash = (lockingHex: string): string => binToHex(sha256.hash(hexToBin(lockingHex)).reverse());

interface RawUtxo {
  tx_hash: string;
  tx_pos: number | bigint;
  value: number | bigint | string;
  height: number | bigint;
  token_data?: { category: string; amount: string | number | bigint; nft?: { capability: string; commitment: string } };
}

export const parseUtxos = (raw: unknown): ChainUtxo[] => {
  if (!Array.isArray(raw)) throw new ChainUnavailableError('listunspent did not return a list');
  return (raw as RawUtxo[]).map((u) => ({
    txid: u.tx_hash,
    vout: Number(u.tx_pos),
    sats: BigInt(u.value),
    height: Number(u.height),
    ...(u.token_data
      ? {
          token: {
            category: u.token_data.category.toLowerCase(),
            amount: BigInt(u.token_data.amount ?? 0),
            ...(u.token_data.nft ? { nft: u.token_data.nft } : {}),
          },
        }
      : {}),
  }));
};

export interface Server {
  url: string;
  host: string;
  port: number;
  encrypted: boolean;
}

const parseServer = (url: string): Server => {
  const u = new URL(url);
  if (u.protocol !== 'wss:' && u.protocol !== 'ws:') throw new Error(`electrum server must be ws(s): ${url}`);
  return { url, host: u.hostname, port: Number(u.port || 50004), encrypted: u.protocol === 'wss:' };
};

/** The part of an Electrum client this module uses (tests pass their own). */
export interface ElectrumLike {
  connect(): Promise<void>;
  request(method: string, ...params: Array<string | number | boolean>): Promise<unknown>;
  disconnect(force?: boolean): Promise<unknown>;
}

const defaultClient = (s: Server, timeoutMs: number): ElectrumLike =>
  new ElectrumClient<ElectrumClientEvents>('sampan', '1.5', s.host, {
    port: s.port,
    encrypted: s.encrypted,
    timeoutInMilliSeconds: timeoutMs,
    useBigInt: true,
  });

export interface ElectrumOptions {
  timeoutMs?: number;
  createClient?: (s: Server, timeoutMs: number) => ElectrumLike;
  log?: ((message: string) => void) | undefined;
}

export class ElectrumChain implements Chain {
  private readonly servers: Server[];
  private index = 0;
  private client: ElectrumLike | undefined;
  private connecting: Promise<ElectrumLike> | undefined;

  constructor(
    urls: string[],
    private readonly opts: ElectrumOptions = {},
  ) {
    if (urls.length === 0) throw new Error('no electrum servers configured');
    this.servers = urls.map(parseServer);
  }

  /** The server currently in use (for health output). */
  get current(): string {
    return this.servers[this.index]!.url;
  }

  private async connect(): Promise<ElectrumLike> {
    if (this.client) return this.client;
    this.connecting ??= (async () => {
      const s = this.servers[this.index]!;
      const c = (this.opts.createClient ?? defaultClient)(s, this.opts.timeoutMs ?? 10_000);
      try {
        await c.connect();
      } catch (e) {
        await c.disconnect(true).catch(() => undefined);
        throw e;
      }
      this.client = c;
      return c;
    })().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  private async rotate(reason: string): Promise<void> {
    const old = this.client;
    this.client = undefined;
    this.opts.log?.(`electrum ${this.current} failed (${reason}); trying the next server`);
    this.index = (this.index + 1) % this.servers.length;
    if (old) await old.disconnect(true).catch(() => undefined);
  }

  /** Runs one request, moving through every server once before giving up. */
  private async request(method: string, ...params: Array<string | number | boolean>): Promise<unknown> {
    let lastError = 'no server answered';
    for (let tries = 0; tries < this.servers.length; tries++) {
      try {
        const c = await this.connect();
        const res = await c.request(method, ...params);
        if (res instanceof Error && method !== 'blockchain.transaction.broadcast') throw res;
        return res;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        await this.rotate(lastError);
      }
    }
    throw new ChainUnavailableError(`Bitcoin Cash servers unavailable: ${lastError}`);
  }

  async listUnspent(lockingHex: string): Promise<ChainUtxo[]> {
    return parseUtxos(await this.request('blockchain.scripthash.listunspent', scriptHash(lockingHex)));
  }

  async historyCount(lockingHex: string): Promise<number> {
    const res = await this.request('blockchain.scripthash.get_history', scriptHash(lockingHex));
    if (!Array.isArray(res)) throw new ChainUnavailableError('get_history did not return a list');
    return res.length;
  }

  async broadcast(txHex: string): Promise<string> {
    const res = await this.request('blockchain.transaction.broadcast', txHex);
    if (res instanceof Error) throw new BroadcastError(res.message);
    if (typeof res !== 'string' || !/^[0-9a-f]{64}$/i.test(res)) throw new BroadcastError(`unexpected broadcast answer`);
    return res.toLowerCase();
  }

  async tipHeight(): Promise<number> {
    const res = (await this.request('blockchain.headers.get_tip')) as { height?: number | bigint } | null;
    if (!res || res.height === undefined) throw new ChainUnavailableError('get_tip did not return a height');
    return Number(res.height);
  }

  async close(): Promise<void> {
    const c = this.client;
    this.client = undefined;
    if (c) await c.disconnect(true).catch(() => undefined);
  }
}
