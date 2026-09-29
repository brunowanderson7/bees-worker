import type { BeesTourSummary } from "../types/tours.js";
import type { BeesTourDetailsResponse } from "../types/tour-details.js";
import type { TourChangeSummary } from "../types/tour-changes.js";
import { compareTours } from "./compare-tours.js";
import { TourStorage, type TourScope } from "./storage.js";

export interface SyncResult {
  total: number;
  updated: number;
  unchanged: number;
  changes: TourChangeSummary[];
  failures: { tourId: string; error: string }[];
}

// Only commit the summary after its details have been fetched successfully.
// A failed tour keeps its old state and is retried on the next run.
export async function synchronizeTours(
  storage: TourStorage,
  scope: TourScope,
  summaries: BeesTourSummary[],
  fetchDetails: (tourId: string) => Promise<BeesTourDetailsResponse>,
  forceId?: string,
): Promise<SyncResult> {
  const ids = new Set<string>();
  for (const summary of summaries) {
    if (!summary.id || typeof summary.status !== "string" || ids.has(summary.id)) {
      throw new Error("Resposta de tours inválida ou com IDs duplicados.");
    }
    ids.add(summary.id);
  }
  const result: SyncResult = { total: summaries.length, updated: 0, unchanged: 0, changes: [], failures: [] };
  for (const summary of summaries) {
    const previous = storage.get(scope, summary.id);
    const [change] = compareTours(previous ? [previous.summary] : [], [summary]);
    if (!change && previous?.details && forceId !== summary.id) {
      result.unchanged++;
      continue;
    }
    try {
      const details = await fetchDetails(summary.id);
      if (!details || details.id !== summary.id || !Array.isArray(details.trips)
        || details.trips.some((trip) => !Array.isArray(trip.visits))) {
        throw new Error("A API retornou detalhes inválidos ou de outra rota.");
      }
      storage.save(scope, summary, details, change);
      result.updated++;
      if (change) result.changes.push(change);
    } catch (error) {
      result.failures.push({ tourId: summary.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}
