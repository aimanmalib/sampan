// One SQLite file (data/sampan.db on the volume) through Node's built-in driver. No ORM. Stores crossings and
// landings: public addresses, txids, amounts and status only. No IP, no xpub, no personal data. Raw quote
// payloads are cleared after `ops.quotePayloadHours`.
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { UNSIGNED } from '../core/activity.js';

export type CrossingKind = 'swap' | 'land' | 'out' | 'in';
export type Origin = 'test' | 'public';

export interface CrossingRow {
  id: string;
  kind: CrossingKind;
  status: string;
  asset: string;
  amount: string;
  address: string;
  deposit_address: string | null;
  txid: string | null;
  route: string | null;
  origin: Origin;
  attempts: number;
  error: string | null;
  quote_json: string | null;
  /** The receipt of a finished crossing out or in (core/receipt), kept after the quote payload is cleared. */
  receipt_json: string | null;
  created_at: number;
  updated_at: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS crossings (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('swap','land','out','in')),
  status TEXT NOT NULL,
  asset TEXT NOT NULL,
  amount TEXT NOT NULL,
  address TEXT NOT NULL,
  deposit_address TEXT,
  txid TEXT,
  route TEXT,
  origin TEXT NOT NULL CHECK (origin IN ('test','public')),
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  quote_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS crossings_kind_status ON crossings (kind, status);
CREATE TABLE IF NOT EXISTS landings (
  address TEXT PRIMARY KEY,
  crossing_id TEXT NOT NULL REFERENCES crossings (id),
  params_json TEXT NOT NULL,
  utxo TEXT,
  finish_txid TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS landings_status ON landings (status);
`;

/** Columns added after the first release, created in place (never by rebuilding a table). */
const ADDED_COLUMNS: Array<[table: string, column: string, type: string]> = [
  ['landings', 'seen_at', 'INTEGER'],
  ['landings', 'finished_at', 'INTEGER'],
  ['landings', 'last_activity', 'INTEGER'],
  ['crossings', 'receipt_json', 'TEXT'],
];

export type LandingStatus = 'watching' | 'idle';

export interface LandingRow {
  address: string;
  crossing_id: string;
  /** The recovery card (core/landing-card), JSON. */
  params_json: string;
  /** First coin seen at the address, "txid:vout". */
  utxo: string | null;
  finish_txid: string | null;
  status: LandingStatus;
  seen_at: number | null;
  finished_at: number | null;
  last_activity: number | null;
  created_at: number;
  updated_at: number;
}

export interface StatsCounts {
  completed: number;
  /** Swaps on BCH that reached the network (txid recorded). Counted apart from landings and crossings. */
  swaps: number;
  returned: number;
  lost: number;
  /** Seconds from the coin being seen to it being finished, completed landings only. */
  medianSeconds: number | null;
}

export interface NewCrossing {
  kind: CrossingKind;
  status: string;
  asset: string;
  amount: string;
  address: string;
  origin: Origin;
  route?: string;
  depositAddress?: string;
  quote?: unknown;
}

/** Crossing statuses that count as done for /api/stats. */
const COMPLETED = ['converted', 'completed'];
const RETURNED = ['returned', 'refunded'];

export class Db {
  private readonly db: DatabaseSync;

  constructor(
    file: string,
    private readonly now: () => number = Date.now,
  ) {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
    for (const [table, column, type] of ADDED_COLUMNS) {
      const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  }

  /** The SQLite handle, for modules that keep their own tables in the same file (server/pay/store.ts). */
  get handle(): DatabaseSync {
    return this.db;
  }

  /** 128-bit random id, hex. */
  static newId(): string {
    return randomBytes(16).toString('hex');
  }

  createCrossing(c: NewCrossing): string {
    const id = Db.newId();
    const t = this.now();
    this.db
      .prepare(
        `INSERT INTO crossings (id, kind, status, asset, amount, address, deposit_address, route, origin, quote_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, c.kind, c.status, c.asset, c.amount, c.address, c.depositAddress ?? null, c.route ?? null, c.origin, c.quote === undefined ? null : JSON.stringify(c.quote), t, t);
    return id;
  }

  getCrossing(id: string): CrossingRow | undefined {
    return this.db.prepare('SELECT * FROM crossings WHERE id = ?').get(id) as CrossingRow | undefined;
  }

  updateCrossing(id: string, patch: Partial<Pick<CrossingRow, 'status' | 'txid' | 'error' | 'attempts' | 'quote_json' | 'receipt_json'>>): void {
    const keys = Object.keys(patch) as Array<keyof typeof patch>;
    if (keys.length === 0) return;
    const sets = keys.map((k) => `${k} = ?`).join(', ');
    const values = keys.map((k) => patch[k] ?? null);
    this.db.prepare(`UPDATE crossings SET ${sets}, updated_at = ? WHERE id = ?`).run(...values, this.now(), id);
  }

  /** The clock rows are written with (receipts measure their time on it). */
  time(): number {
    return this.now();
  }

  /** Clears raw quote payloads older than `hours`. Returns how many rows were cleared. */
  purgeQuotes(hours: number): number {
    const cutoff = this.now() - hours * 3_600_000;
    const res = this.db.prepare('UPDATE crossings SET quote_json = NULL WHERE quote_json IS NOT NULL AND created_at < ?').run(cutoff);
    return Number(res.changes);
  }

  createLanding(l: { address: string; crossingId: string; card: unknown }): void {
    const t = this.now();
    this.db
      .prepare(
        `INSERT INTO landings (address, crossing_id, params_json, status, last_activity, created_at, updated_at)
         VALUES (?, ?, ?, 'watching', ?, ?, ?)`,
      )
      .run(l.address, l.crossingId, JSON.stringify(l.card), t, t, t);
  }

  landingOf(crossingId: string): LandingRow | undefined {
    return this.db.prepare('SELECT * FROM landings WHERE crossing_id = ?').get(crossingId) as LandingRow | undefined;
  }

  landingByAddress(address: string): LandingRow | undefined {
    return this.db.prepare('SELECT * FROM landings WHERE address = ?').get(address) as LandingRow | undefined;
  }

  watchedLandings(): LandingRow[] {
    return this.db.prepare(`SELECT * FROM landings WHERE status = 'watching' ORDER BY created_at`).all() as unknown as LandingRow[];
  }

  updateLanding(
    address: string,
    patch: Partial<Pick<LandingRow, 'utxo' | 'finish_txid' | 'status' | 'seen_at' | 'finished_at' | 'last_activity'>>,
  ): void {
    const keys = Object.keys(patch) as Array<keyof typeof patch>;
    if (keys.length === 0) return;
    const sets = keys.map((k) => `${k} = ?`).join(', ');
    const values = keys.map((k) => patch[k] ?? null);
    this.db.prepare(`UPDATE landings SET ${sets}, updated_at = ? WHERE address = ?`).run(...values, this.now(), address);
  }

  /** "My activity": crossings made for any of these address keys (core/activity addressKey: no CashAddr prefix), newest first. */
  crossingsFor(keys: string[], limit: number): CrossingRow[] {
    if (keys.length === 0) return [];
    const marks = keys.map(() => '?').join(', ');
    // Quotes built or planned but never signed are not crossings yet (core/activity UNSIGNED).
    const unsigned = UNSIGNED.map(() => '(kind = ? AND status = ?)').join(' OR ');
    return this.db
      .prepare(
        `SELECT * FROM crossings WHERE lower(substr(address, instr(address, ':') + 1)) IN (${marks}) AND NOT (${unsigned})
         ORDER BY created_at DESC, id LIMIT ?`,
      )
      .all(...keys, ...UNSIGNED.flat(), limit) as unknown as CrossingRow[];
  }

  /**
   * The crossing a transaction id belongs to (bare, lower case): the row's own txid, the payment or finishing
   * transaction of its landing address, or the payout kept in its receipt.
   */
  crossingByTxid(bare: string): string | undefined {
    const row = this.db
      .prepare(
        `SELECT id FROM crossings WHERE lower(txid) IN (?, ?)
         UNION ALL SELECT crossing_id AS id FROM landings WHERE lower(utxo) LIKE ? OR lower(finish_txid) = ?
         UNION ALL SELECT id FROM crossings WHERE instr(lower(receipt_json), ?) > 0
         LIMIT 1`,
      )
      .get(bare, `0x${bare}`, `${bare}:%`, bare, bare) as { id: string } | undefined;
    return row?.id;
  }

  /** Rows counted as other people's, with the user address each was made for. */
  publicCrossings(): Array<{ id: string; address: string; txid: string | null }> {
    return this.db.prepare(`SELECT id, address, txid FROM crossings WHERE origin = 'public'`).all() as Array<{
      id: string;
      address: string;
      txid: string | null;
    }>;
  }

  setOrigin(id: string, origin: Origin): void {
    this.db.prepare('UPDATE crossings SET origin = ? WHERE id = ?').run(origin, id);
  }

  /** Counts for the "Measured" line: landings and crossings between chains, and broadcast swaps apart. No origin = all rows. */
  stats(origin?: Origin): StatsCounts {
    const origins: Origin[] = origin ? [origin] : ['test', 'public'];
    const om = origins.map(() => '?').join(',');
    const count = (statuses: string[]): number => {
      const marks = statuses.map(() => '?').join(',');
      const row = this.db
        .prepare(`SELECT COUNT(*) AS n FROM crossings WHERE kind != 'swap' AND origin IN (${om}) AND status IN (${marks})`)
        .get(...origins, ...statuses) as { n: number };
      return Number(row.n);
    };
    const swaps = this.db
      .prepare(`SELECT COUNT(*) AS n FROM crossings WHERE kind = 'swap' AND origin IN (${om}) AND status = 'broadcast' AND txid IS NOT NULL`)
      .get(...origins) as { n: number };
    const times = this.db
      .prepare(
        `SELECT l.finished_at - l.seen_at AS ms FROM landings l JOIN crossings c ON c.id = l.crossing_id
         WHERE c.origin IN (${om}) AND c.status = 'converted' AND l.seen_at IS NOT NULL AND l.finished_at IS NOT NULL ORDER BY ms`,
      )
      .all(...origins) as Array<{ ms: number }>;
    return {
      completed: count(COMPLETED),
      swaps: Number(swaps.n),
      returned: count(RETURNED),
      lost: count(['lost']),
      medianSeconds: median(times.map((t) => Number(t.ms) / 1000)),
    };
  }

  close(): void {
    this.db.close();
  }
}

/** Middle value of a sorted list (mean of the two middle values for an even count); null when empty. */
export function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
