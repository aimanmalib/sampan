// The atom block of config/sampan.json: the atomic swap route (USDC on Base <-> PUSD on Bitcoin Cash) offered next to
// THORChain. Pure. The route runs from a byte copy of a client built at one commit of its own repository; this block
// names that file, its hash and the contract it must point at. features.atom switches the route on.

/** Flows the atomic swap service offers, in its own names. */
export const ATOM_FLOWS = ['usdc-to-pusd', 'pusd-to-usdc'] as const;
export type AtomFlow = (typeof ATOM_FLOWS)[number];

export interface AtomConfig {
  /** Same-origin path of the client file under web/public (the commit is part of the name, so a new build is a new URL). */
  clientUrl: string;
  /** The commit the client was built from (40 hex). */
  clientCommit: string;
  /** sha256 of the client file, lower-case hex. */
  clientSha256: string;
  /** The AtomLock contract on Base; /atom/api/health must report the same address before the route is shown. */
  atomLock: string;
  /** The service API on the same host. */
  apiPath: string;
  /** Flows offered on the page; a flow is listed only after a swap through the page has been measured on mainnet. */
  flows: AtomFlow[];
  /** How long the page waits for /atom/api/health before it leaves the route out. */
  healthTimeoutMs: number;
  /** Pause after the amount stops changing before the page asks the service for a quote. */
  quotePauseMs: number;
  /** How often the page asks the service about a running swap. */
  pollSeconds: number;
  /** Origins the client connects to (Electrum over wss, Base RPC over https); added to connect-src only while the route is on. */
  connect: string[];
}

const COMMIT = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** Returns a list of problems; an empty list means the block can be used. */
export function validateAtom(a: AtomConfig | undefined): string[] {
  if (!a || typeof a !== 'object') return ['atom: object'];
  const errors: string[] = [];
  const need = (ok: boolean, message: string): void => {
    if (!ok) errors.push(message);
  };
  need(/^\/vendor\/atom-client-[0-9a-f]{7}\.js$/.test(a.clientUrl), 'atom.clientUrl: /vendor/atom-client-<short commit>.js');
  need(COMMIT.test(a.clientCommit), 'atom.clientCommit: 40 lower-case hex characters');
  need(COMMIT.test(a.clientCommit) && a.clientUrl.includes(a.clientCommit.slice(0, 7)), 'atom.clientUrl: names the short form of atom.clientCommit');
  need(SHA256.test(a.clientSha256), 'atom.clientSha256: 64 lower-case hex characters');
  need(EVM_ADDRESS.test(a.atomLock), 'atom.atomLock: 20-byte hex address');
  need(/^\/[\w/-]+[^/]$/.test(a.apiPath), 'atom.apiPath: a same-origin path without a trailing slash');
  need(
    Array.isArray(a.flows) && a.flows.every((f) => (ATOM_FLOWS as readonly string[]).includes(f)) && new Set(a.flows).size === a.flows.length,
    'atom.flows: usdc-to-pusd and/or pusd-to-usdc, each at most once',
  );
  need(Number.isInteger(a.healthTimeoutMs) && a.healthTimeoutMs > 0, 'atom.healthTimeoutMs: positive integer');
  need(Number.isInteger(a.quotePauseMs) && a.quotePauseMs >= 0, 'atom.quotePauseMs: integer, at least 0');
  need(Number.isInteger(a.pollSeconds) && a.pollSeconds > 0, 'atom.pollSeconds: positive integer');
  need(
    Array.isArray(a.connect) && a.connect.every((u) => /^(wss|https):\/\/[^\s/]+\/?$/.test(u)),
    'atom.connect: wss or https origins (host and port only)',
  );
  return errors;
}

/** Origins to add to connect-src: the client's servers while the route is on, none while it is off. */
export function atomConnectOrigins(enabled: boolean, a: AtomConfig): string[] {
  return enabled ? a.connect.map((u) => new URL(u).origin) : [];
}
