import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { TourStorage } from "./storage.js";
import type { TourScope } from "./storage.js";
import type { BeesTourSummary } from "../types/tours.js";
import type { BeesTourDetailsResponse } from "../types/tour-details.js";

interface LegacySnapshot {
  metadata: TourScope;
  content: BeesTourSummary[];
}
async function readJson<T>(filename: string): Promise<T | null> {
  try { return JSON.parse(await readFile(filename, "utf8")) as T; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function migrateLegacyData(storage: TourStorage, dataDir = path.resolve("data")): Promise<number> {
  const key = `legacy-json-v1:${path.resolve(dataDir)}`;
  if (storage.hasMigration(key)) return 0;
  const current = await readJson<LegacySnapshot>(path.join(dataDir, "tours", "current.json"))
    ?? await readJson<LegacySnapshot>(path.join(dataDir, "tours.json"));
  if (!current) throw new Error("Nenhum snapshot JSON atual encontrado para importar.");
  if (!current.metadata?.date || !current.metadata.distributionCenterId || !Array.isArray(current.content)) {
    throw new Error("Snapshot legado inválido.");
  }
  const details = new Map<string, BeesTourDetailsResponse>();
  const dir = path.join(dataDir, "tour-details");
  let files: string[];
  try { files = await readdir(dir); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    files = [];
  }
  for (const file of files.filter((file) => file.endsWith(".json"))) {
    const data = await readJson<{ content: BeesTourDetailsResponse }>(path.join(dir, file));
    if (!data?.content?.id || !Array.isArray(data.content.trips)) throw new Error(`Detalhes inválidos: ${file}`);
    details.set(data.content.id, data.content);
  }
  let imported = 0;
  for (const summary of current.content) {
    // Existing SQLite records are authoritative, including on retry after partial import.
    if (storage.get(current.metadata, summary.id)) continue;
    storage.save(current.metadata, summary, details.get(summary.id) ?? null);
    imported++;
  }
  storage.markMigration(key);
  return imported;
}
