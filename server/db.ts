// One SQLite file (data/sampan.db on the volume) through Node's built-in driver. No ORM. Stores crossings and
// landings: public addresses, txids, amounts and status only. No IP, no xpub, no personal data. Raw quote
// payloads are cleared after `ops.quotePayloadHours`.
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

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
`;

export interface NewCrossing {
  kind: CrossingKind;
  status: string;
  asset: string;
  amount: string;
  address: string;
  origin: Origin;
  route?: string;
  quote?: unknown;
}

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
        `INSERT INTO crossings (id, kind, status, asset, amount, address, route, origin, quote_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, c.kind, c.status, c.asset, c.amount, c.address, c.route ?? null, c.origin, c.quote === undefined ? null : JSON.stringify(c.quote), t, t);
    return id;
  }

  getCrossing(id: string): CrossingRow | undefined {
    return this.db.prepare('SELECT * FROM crossings WHERE id = ?').get(id) as CrossingRow | undefined;
  }

  updateCrossing(id: string, patch: Partial<Pick<CrossingRow, 'status' | 'txid' | 'error' | 'attempts' | 'quote_json'>>): void {
    const keys = Object.keys(patch) as Array<keyof typeof patch>;
    if (keys.length === 0) return;
    const sets = keys.map((k) => `${k} = ?`).join(', ');
    const values = keys.map((k) => patch[k] ?? null);
    this.db.prepare(`UPDATE crossings SET ${sets}, updated_at = ? WHERE id = ?`).run(...values, this.now(), id);
  }

  /** Clears raw quote payloads older than `hours`. Returns how many rows were cleared. */
  purgeQuotes(hours: number): number {
    const cutoff = this.now() - hours * 3_600_000;
    const res = this.db.prepare('UPDATE crossings SET quote_json = NULL WHERE quote_json IS NOT NULL AND created_at < ?').run(cutoff);
    return Number(res.changes);
  }

  close(): void {
    this.db.close();
  }
}
