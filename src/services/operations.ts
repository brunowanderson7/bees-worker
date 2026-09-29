import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { BrowserContext } from "playwright";
import { createPersistentBrowser } from "./browser.js";
import { BEES_CONFIG } from "../config/bees.js";
import { databasePath, TourStorage } from "./storage.js";
import { resolveDate, runSync } from "./sync-cli.js";
import { getReturnsToday } from "./returns-today.js";

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const jobTypes = ["sync:tours", "analyze:tours", "sync:tour", "returns:today", "remove:finalized"] as const;
export type JobType = typeof jobTypes[number];
export interface JobInput { type: JobType; date?: string; tourId?: string }

export function validateJob(value: unknown): JobInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "Objeto JSON esperado.");
  const input = value as Record<string, unknown>;
  if (!jobTypes.includes(input.type as JobType)
    || Object.keys(input).some((key) => !["type", "date", "tourId"].includes(key))) {
    throw new HttpError(400, "Tipo de operação ou campo inválido.");
  }
  if (input.date !== undefined) {
    if (typeof input.date !== "string") throw new HttpError(400, "Data inválida.");
    try { resolveDate(input.date); } catch { throw new HttpError(400, "Data inválida: use YYYY-MM-DD."); }
  }
  if (input.type === "sync:tour") {
    if (typeof input.tourId !== "string" || !input.tourId.trim() || input.tourId.length > 200) {
      throw new HttpError(400, "Informe tourId.");
    }
  } else if (input.tourId !== undefined) throw new HttpError(400, "tourId só é aceito em sync:tour.");
  if (input.type === "returns:today" && input.date !== undefined) throw new HttpError(400, "returns:today usa a data atual.");
  // Fix the date when accepting the job, including cleanup (never delete all dates by default).
  return { type: input.type as JobType,
    ...(input.type !== "returns:today" ? { date: resolveDate(input.date as string | undefined) } : {}),
    ...(input.type === "sync:tour" ? { tourId: input.tourId as string } : {}) };
}

async function executeJob(input: JobInput): Promise<unknown> {
  if (input.type === "returns:today") {
    const result = await getReturnsToday({ offline: false, headless: true });
    return result;
  }
  if (input.type === "remove:finalized") {
    const storage = new TourStorage();
    try { return { removed: storage.removeFinalized({ date: input.date!, distributionCenterId: BEES_CONFIG.distributionCenterId }) }; }
    finally { storage.close(); }
  }
  return runSync(input.date, input.tourId, true);
}

export class Operations {
  private db: DatabaseSync;
  private active: string | null = null;
  private login: BrowserContext | null = null;
  private loginTimer?: NodeJS.Timeout;
  private stopped = false;
  constructor(filename = databasePath(), private execute = executeJob,
    private launch = () => createPersistentBrowser(false)) {
    if (filename !== ":memory:") mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY, type TEXT NOT NULL, state TEXT NOT NULL, input_json TEXT NOT NULL,
        created_at TEXT NOT NULL, finished_at TEXT, result_json TEXT, error TEXT
      );`);
    this.db.prepare("UPDATE jobs SET state='interrupted', finished_at=?, error='Processo reiniciado durante a execução.' WHERE state='running'")
      .run(new Date().toISOString());
  }
  status() { return { active: this.active, loginOpen: Boolean(this.login) }; }
  private reserve(name: string) {
    if (this.stopped) throw new HttpError(503, "Serviço encerrando.");
    if (this.active) throw new HttpError(409, "Há uma operação ou login em andamento. Aguarde ou encerre o login.");
    this.active = name;
  }
  async exclusive<T>(action: () => Promise<T>): Promise<T> {
    this.reserve("refresh");
    try { return await action(); } finally { this.active = null; }
  }
  getJob(id: string) {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id=?").get(id);
    if (!row) throw new HttpError(404, "Job não encontrado.");
    return { id: row.id, type: row.type, state: row.state, createdAt: row.created_at,
      finishedAt: row.finished_at, input: JSON.parse(row.input_json as string),
      result: row.result_json ? JSON.parse(row.result_json as string) : null, error: row.error };
  }
  startJob(input: JobInput) {
    const id = randomUUID();
    this.reserve(id);
    try {
      this.db.prepare("INSERT INTO jobs (id,type,state,input_json,created_at) VALUES (?,?,'running',?,?)")
        .run(id, input.type, JSON.stringify(input), new Date().toISOString());
    } catch (error) { this.active = null; throw error; }
    // Persist and respond immediately; the caller polls GET /jobs/:id.
    void Promise.resolve().then(() => this.execute(input)).then((result) => {
      const partial = (result as { metadata?: { complete?: boolean } })?.metadata?.complete === false;
      this.db.prepare("UPDATE jobs SET state=?, finished_at=?, result_json=? WHERE id=?")
        .run(partial ? "partial" : "succeeded", new Date().toISOString(), JSON.stringify(result ?? null), id);
    }).catch((error: unknown) => {
      // Do not persist upstream response bodies or authentication material in public job errors.
      console.error(`Job ${id} falhou:`, error);
      this.db.prepare("UPDATE jobs SET state='failed', finished_at=?, error=? WHERE id=?")
        .run(new Date().toISOString(), "Falha na operação. Consulte os logs do serviço.", id);
    }).finally(() => { this.active = null; });
    return { id, state: "running", statusUrl: `/jobs/${id}` };
  }
  async openLogin() {
    if (this.login) return { loginOpen: true, desktopUrl: "/desktop/vnc.html?autoconnect=true&resize=scale&path=desktop/websockify" };
    this.reserve("login");
    try {
      this.login = await this.launch();
      this.login.once("close", () => {
        this.login = null; this.active = null; clearTimeout(this.loginTimer);
      });
      const page = this.login.pages()[0] ?? await this.login.newPage();
      await page.goto(BEES_CONFIG.portalUrl, { waitUntil: "domcontentloaded" });
      this.loginTimer = setTimeout(() => { void this.closeLogin().catch(console.error); }, 30 * 60_000);
      this.loginTimer.unref();
      return { loginOpen: true, desktopUrl: "/desktop/vnc.html?autoconnect=true&resize=scale&path=desktop/websockify" };
    } catch (error) {
      if (this.login) await this.closeLogin();
      else this.active = null;
      throw error;
    }
  }
  async closeLogin() {
    clearTimeout(this.loginTimer);
    if (this.active === "login" && !this.login) throw new HttpError(409, "Login ainda está abrindo.");
    if (this.login) await this.login.close();
    return { loginOpen: false };
  }
  async shutdown() {
    this.stopped = true;
    if (this.login) await this.closeLogin();
  }
  close() {
    if (this.active) throw new Error("Há uma operação em andamento.");
    this.db.close();
  }
}
