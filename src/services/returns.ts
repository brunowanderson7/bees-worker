import type { ScopedStoredTour } from "./storage.js";

export interface ReturnRecord {
  tourId: string;
  tourDisplayId: string;
  tourDate: string;
  driverId: string;
  driverName: string;
  tripId: string;
  accountId: string;
  accountExternalId: string;
  accountName: string;
  status: string;
  returnedAt: string;
}

export function collectReturns(tours: ScopedStoredTour[], options: {
  date: string; timezone: string; distributionCenterId: string; statuses: string[];
}) {
  const statuses = new Set(options.statuses.map((status) => status.trim().toUpperCase()).filter(Boolean));
  if (!statuses.size) throw new Error("Informe ao menos um status de devolução.");
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: options.timezone, year: "numeric", month: "2-digit", day: "2-digit",
  });
  const content: ReturnRecord[] = [];
  const issues: { tourId: string; tripId?: string; accountId?: string; reason: string }[] = [];
  let visitsChecked = 0;
  for (const { summary, details, scope } of tours) {
    if (!details) {
      issues.push({ tourId: summary.id, reason: "MISSING_DETAILS" });
      continue;
    }
    for (const trip of details.trips) {
      for (const visit of trip.visits) {
        visitsChecked++;
        if (!statuses.has(visit.status.trim().toUpperCase())) continue;
        const updates = (visit.updates ?? []).filter((update) => statuses.has(update.status.trim().toUpperCase()));
        // A timezone is required: never interpret an ambiguous timestamp in the host timezone.
        const valid = updates.filter((update) => /(?:Z|[+-]\d{2}:?\d{2})$/i.test(update.timestamp)
          && Number.isFinite(Date.parse(update.timestamp)));
        if (!valid.length || valid.length !== updates.length) {
          issues.push({ tourId: summary.id, tripId: trip.id, accountId: visit.accountId,
            reason: "MISSING_OR_INVALID_RETURN_TIMESTAMP" });
          continue;
        }
        const latest = valid.reduce((a, b) => Date.parse(a.timestamp) >= Date.parse(b.timestamp) ? a : b);
        const timestamp = new Date(latest.timestamp);
        if (formatter.format(timestamp) !== options.date) continue;
        content.push({ tourId: summary.id, tourDisplayId: summary.displayId, tourDate: scope.date,
          driverId: summary.driverId, driverName: summary.driverName, tripId: trip.id,
          accountId: visit.accountId, accountExternalId: visit.accountExternalId, accountName: visit.accountName,
          status: visit.status, returnedAt: timestamp.toISOString() });
      }
    }
  }
  content.sort((a, b) => a.returnedAt.localeCompare(b.returnedAt) || a.tourId.localeCompare(b.tourId)
    || a.tripId.localeCompare(b.tripId) || a.accountId.localeCompare(b.accountId));
  return {
    metadata: { date: options.date, timezone: options.timezone, distributionCenterId: options.distributionCenterId,
      returnStatuses: [...statuses], toursChecked: tours.length, visitsChecked,
      totalReturns: content.length, complete: issues.length === 0, generatedAt: new Date().toISOString() },
    content, issues,
  };
}
