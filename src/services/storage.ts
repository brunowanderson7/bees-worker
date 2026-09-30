import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { BeesTourSummary } from "../types/tours.js";
import type { BeesTourDetailsResponse } from "../types/tour-details.js";
import type { TourChangeSummary } from "../types/tour-changes.js";
import { FINALIZED_STATUSES } from "./tour-status.js";

export interface TourScope { date: string; distributionCenterId: string }
export interface StoredTour {
  summary: BeesTourSummary;
  details: BeesTourDetailsResponse | null;
  updatedAt: string;
}
export interface ScopedStoredTour extends StoredTour { scope: TourScope }
export const databasePath = () => path.resolve(process.env.BEES_DB_PATH ?? "data/bees.sqlite");

export class TourStorage {
  private readonly db: DatabaseSync;

  constructor(filename = databasePath()) {
    if (filename !== ":memory:") mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS tours (
        center_id TEXT NOT NULL, date TEXT NOT NULL, id TEXT NOT NULL,
        display_id TEXT NOT NULL, status TEXT NOT NULL, summary_json TEXT NOT NULL,
        details_json TEXT, updated_at TEXT NOT NULL,
        PRIMARY KEY (center_id, date, id)
      );
      CREATE INDEX IF NOT EXISTS tours_status ON tours(status);
      CREATE TABLE IF NOT EXISTS tour_changes (
        change_id INTEGER PRIMARY KEY, center_id TEXT NOT NULL, date TEXT NOT NULL,
        tour_id TEXT NOT NULL, detected_at TEXT NOT NULL, change_json TEXT NOT NULL,
        FOREIGN KEY (center_id, date, tour_id) REFERENCES tours(center_id, date, id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, imported_at TEXT NOT NULL);
    `);
  }

  close(): void { this.db.close(); }

  private transaction<T>(action: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  get(scope: TourScope, id: string): StoredTour | null {
    const row = this.db.prepare(`SELECT summary_json, details_json, updated_at FROM tours
      WHERE center_id = ? AND date = ? AND id = ?`).get(scope.distributionCenterId, scope.date, id);
    return row ? {
      summary: JSON.parse(row.summary_json as string),
      details: row.details_json ? JSON.parse(row.details_json as string) : null,
      updatedAt: row.updated_at as string,
    } : null;
  }

  list(scope: TourScope): BeesTourSummary[] {
    return this.db.prepare("SELECT summary_json FROM tours WHERE center_id = ? AND date = ? ORDER BY id")
      .all(scope.distributionCenterId, scope.date).map((row) => JSON.parse(row.summary_json as string));
  }

  findByDisplayId(distributionCenterId: string, displayId: string, date?: string): ScopedStoredTour[] {
    const rows = this.db.prepare(`SELECT * FROM tours WHERE center_id = ? AND display_id = ?
      ${date ? "AND date = ?" : ""} ORDER BY date DESC, updated_at DESC, id`)
      .all(distributionCenterId, displayId, ...(date ? [date] : []));
    // Map numbers can be reused on different days; without a date use the latest day.
    return rows.filter((row) => row.date === rows[0]?.date).map((row) => ({
      scope: { date: row.date as string, distributionCenterId: row.center_id as string },
      summary: JSON.parse(row.summary_json as string),
      details: row.details_json ? JSON.parse(row.details_json as string) : null,
      updatedAt: row.updated_at as string,
    }));
  }

  listLatest(distributionCenterId: string): ScopedStoredTour[] {
    const rows = this.db.prepare(`SELECT * FROM (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY updated_at DESC, date DESC) AS position
      FROM tours WHERE center_id = ?
    ) WHERE position = 1 ORDER BY id`).all(distributionCenterId);
    return rows.map((row) => ({
      scope: { date: row.date as string, distributionCenterId: row.center_id as string },
      summary: JSON.parse(row.summary_json as string),
      details: row.details_json ? JSON.parse(row.details_json as string) : null,
      updatedAt: row.updated_at as string,
    }));
  }

  save(scope: TourScope, summary: BeesTourSummary, details: BeesTourDetailsResponse | null, change?: TourChangeSummary): void {
    if (!summary.id || !summary.status || (details && details.id !== summary.id)) {
      throw new Error("Resumo ou detalhes inválidos: o ID dos detalhes deve corresponder à rota.");
    }
    const now = new Date().toISOString();
    this.transaction(() => {
      this.db.prepare(`INSERT INTO tours VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(center_id, date, id) DO UPDATE SET display_id=excluded.display_id,
        status=excluded.status, summary_json=excluded.summary_json,
        details_json=excluded.details_json, updated_at=excluded.updated_at`)
        .run(scope.distributionCenterId, scope.date, summary.id, summary.displayId, summary.status,
          JSON.stringify(summary), details ? JSON.stringify(details) : null, now);
      if (change) this.db.prepare(`INSERT INTO tour_changes
        (center_id, date, tour_id, detected_at, change_json) VALUES (?, ?, ?, ?, ?)`)
        .run(scope.distributionCenterId, scope.date, summary.id, now, JSON.stringify(change));
    });
  }

  readChanges(scope: TourScope): TourChangeSummary[] {
    return this.db.prepare(`SELECT change_json FROM tour_changes WHERE center_id = ? AND date = ? ORDER BY change_id`)
      .all(scope.distributionCenterId, scope.date).map((row) => JSON.parse(row.change_json as string));
  }

  removeFinalized(scope?: TourScope): number {
    const filter = scope ? " AND center_id = ? AND date = ?" : "";
    const placeholders = FINALIZED_STATUSES.map(() => "?").join(", ");
    return Number(this.db.prepare(`DELETE FROM tours WHERE UPPER(TRIM(status)) IN (${placeholders})${filter}`)
      .run(...FINALIZED_STATUSES, ...(scope ? [scope.distributionCenterId, scope.date] : [])).changes);
  }

  hasMigration(name: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM migrations WHERE name = ?").get(name));
  }

  markMigration(name: string): void {
    this.db.prepare("INSERT INTO migrations VALUES (?, ?)").run(name, new Date().toISOString());
  }
}
