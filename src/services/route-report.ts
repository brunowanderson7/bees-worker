import { BEES_CONFIG } from "../config/bees.js";
import { HttpError } from "./operations.js";
import { TourStorage, type ScopedStoredTour } from "./storage.js";
import { runSync } from "./sync-cli.js";

function latestTimestamp(values: (string | undefined)[]): string | null {
  const times = values.filter(
    (value): value is string =>
      typeof value === "string" &&
      /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) &&
      Number.isFinite(Date.parse(value)),
  );
  return times.length
    ? new Date(
        Math.max(...times.map((value) => Date.parse(value))),
      ).toISOString()
    : null;
}

export function buildRouteReport(tour: ScopedStoredTour) {
  const { summary, details, scope } = tour;
  if (!details)
    throw new HttpError(
      409,
      "Detalhes ainda não sincronizados. Use refresh=true ou o job sync:tour.",
    );
  const clients = details.trips.flatMap((trip) =>
    trip.visits.map((visit, visitIndex) => {
      const outOfRadius =
        typeof visit.tags?.outOfRadius === "boolean"
          ? visit.tags.outOfRadius
          : null;
      return {
        tripId: trip.id,
        tripDisplayId: trip.displayId,
        visitIndex,
        accountId: visit.accountId,
        accountExternalId: visit.accountExternalId,
        accountName: visit.accountName,
        status: visit.status,
        lastTimestamp: latestTimestamp([
          visit.updatedAt,
          ...(visit.updates ?? []).map((update) => update.timestamp),
        ]),
        outOfRadius,
        withinRadius: outOfRadius === null ? null : !outOfRadius,
      };
    }),
  );
  const counts = new Map<string, number>();
  for (const client of clients)
    counts.set(client.status, (counts.get(client.status) ?? 0) + 1);
  return {
    metadata: {
      source: "sqlite",
      syncedAt: tour.updatedAt,
      generatedAt: new Date().toISOString(),
      date: scope.date,
      distributionCenterId: scope.distributionCenterId,
      timezone: BEES_CONFIG.timezone,
    },
    tour: {
      id: summary.id,
      displayId: summary.displayId,
      status: summary.status,
      driverId: summary.driverId,
      driverName: summary.driverName,
      vehicle: summary.vehicle,
      lastTimestamp: latestTimestamp([
        summary.lastUpdateTimestamp,
        details.lastUpdateTimestamp,
      ]),
    },
    summary: {
      totalTrips: details.trips.length,
      totalVisits: clients.length,
      totalClients: new Set(clients.map((client) => client.accountId)).size,
      countsByStatus: Object.fromEntries(
        [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)),
      ),
      radius: {
        outside: clients.filter((client) => client.outOfRadius === true).length,
        inside: clients.filter((client) => client.outOfRadius === false).length,
        unknown: clients.filter((client) => client.outOfRadius === null).length,
      },
    },
    clients,
  };
}

export async function getRouteReport(
  displayId: string,
  options: { date?: string; refresh?: boolean } = {},
) {
  const storage = new TourStorage();
  try {
    const matches = storage.findByDisplayId(
      BEES_CONFIG.distributionCenterId,
      displayId,
      options.date,
    );
    if (!matches.length)
      throw new HttpError(
        404,
        "Mapa não encontrado no SQLite. Sincronize os tours da data desejada.",
      );
    if (matches.length > 1)
      throw new HttpError(
        409,
        "Mais de um tour possui este displayId na mesma data.",
      );
    let tour = matches[0];
    if (options.refresh) {
      await runSync(tour.scope.date, tour.summary.id, true);
      const updated = storage.get(tour.scope, tour.summary.id);
      if (!updated)
        throw new HttpError(404, "Mapa não encontrado após atualização.");
      tour = { ...updated, scope: tour.scope };
    }
    const report = buildRouteReport(tour);
    report.metadata.source = options.refresh ? "bees" : "sqlite";
    return report;
  } finally {
    storage.close();
  }
}
