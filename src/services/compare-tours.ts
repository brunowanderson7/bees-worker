import { isDeepStrictEqual } from "node:util";
import type { BeesTourSummary } from "../types/tours.js";
import type { TourChangeSummary, TourFieldChange } from "../types/tour-changes.js";

function fields(previous: unknown, current: unknown, prefix = ""): TourFieldChange[] {
  if (isDeepStrictEqual(previous, current)) return [];
  if (previous && current && typeof previous === "object" && typeof current === "object"
    && !Array.isArray(previous) && !Array.isArray(current)) {
    const before = previous as Record<string, unknown>;
    const after = current as Record<string, unknown>;
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
      .flatMap((key) => fields(before[key], after[key], prefix ? `${prefix}.${key}` : key));
  }
  return [{ field: prefix, previous: previous ?? null, current: current ?? null }];
}

export function compareTour(previous: BeesTourSummary, current: BeesTourSummary): TourChangeSummary | null {
  const changes = fields(previous, current);
  return changes.length ? { ...current, changes } : null;
}

export function compareTours(previousTours: BeesTourSummary[], currentTours: BeesTourSummary[]): TourChangeSummary[] {
  const previous = new Map(previousTours.map((tour) => [tour.id, tour]));
  return currentTours.flatMap((tour) => {
    const before = previous.get(tour.id);
    const change = before ? compareTour(before, tour) : {
      ...tour, changes: [{ field: "$new", previous: null, current: tour }],
    };
    return change ? [change] : [];
  });
}
