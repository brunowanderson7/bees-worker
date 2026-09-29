import test from "node:test";
import assert from "node:assert/strict";
import { collectReturns } from "../services/returns.js";
import { TourStorage, type ScopedStoredTour } from "../services/storage.js";
import type { TourVisit } from "../types/tour-details.js";

const options = { date: "2026-09-29", timezone: "America/Fortaleza",
  distributionCenterId: "0730882", statuses: ["DEFINITELY_RETURNED"] };
function visit(timestamp: string, status = "DEFINITELY_RETURNED"): TourVisit {
  return { accountId: "client", accountExternalId: "123", accountName: "Cliente", status,
    updates: [{ status: "DEFINITELY_RETURNED", timestamp }] };
}
function stored(visits: TourVisit[]): ScopedStoredTour {
  return {
    scope: { date: "2026-09-28", distributionCenterId: options.distributionCenterId },
    updatedAt: "2026-09-29T12:00:00Z",
    summary: { id: "tour", displayId: "42", externalId: "tour", driverId: "driver", driverName: "Motorista",
      vehicle: { displayId: "vehicle", licensePlate: "ABC1234" }, status: "POST_ROUTE", hasKeyAccount: false,
      overnight: false, searchTerms: [], visitsAmount: { concluded: 0, finalStatus: 1, inTreatment: 0,
        postponed: 0, rescheduled: 0, total: visits.length, unfulfilled: 1, waitingModulation: 0 } },
    details: { id: "tour", displayId: "42", externalId: "tour", trips: [
      { id: "trip", displayId: "1", externalId: "trip", status: "FINISHED", visits },
    ] },
  };
}

test("returns use the event date in the configured timezone, including older tours", () => {
  const result = collectReturns([stored([
    visit("2026-09-29T02:59:59Z"), // Yesterday locally.
    visit("2026-09-29T03:00:00Z"),
    visit("2026-09-30T02:59:59Z", "definitely_returned"),
    visit("2026-09-30T03:00:00Z"), // Tomorrow locally.
    visit("2026-09-29T12:00:00Z", "DELIVERED"),
  ])], options);
  assert.equal(result.metadata.visitsChecked, 5);
  assert.equal(result.metadata.totalReturns, 2);
  assert.equal(result.metadata.complete, true);
  assert.equal(result.content[0].tourDate, "2026-09-28");
  assert.equal(result.content[0].accountExternalId, "123");
  assert.equal(result.content[1].returnedAt, "2026-09-30T02:59:59.000Z");
});

test("uses the latest return event, never the generic updatedAt", () => {
  const client = visit("2026-09-29T12:00:00Z");
  client.updatedAt = "2026-09-29T20:00:00Z";
  client.updates = [
    { status: "DEFINITELY_RETURNED", timestamp: "2026-09-29T15:00:00Z" },
    { status: "DEFINITELY_RETURNED", timestamp: "2026-09-28T12:00:00Z" },
    { status: "DEFINITELY_RETURNED", timestamp: "2026-09-29T12:00:00Z" },
  ];
  assert.equal(collectReturns([stored([client])], options).content[0].returnedAt, "2026-09-29T15:00:00.000Z");
  client.updates = [{ status: "DEFINITELY_RETURNED", timestamp: "2026-09-28T12:00:00Z" }];
  assert.equal(collectReturns([stored([client])], options).content.length, 0);
});

test("missing details and ambiguous timestamps mark the report incomplete", () => {
  const missing = stored([]);
  missing.details = null;
  const noEvent = visit("2026-09-29T12:00:00Z");
  noEvent.updates = [];
  const result = collectReturns([missing, stored([noEvent, visit("2026-09-29T12:00:00"), visit("invalid")])], options);
  assert.equal(result.metadata.complete, false);
  assert.equal(result.issues.length, 4);
  assert.equal(result.content.length, 0);
});

test("return status codes are configurable and an empty result is valid", () => {
  const client = visit("2026-09-29T12:00:00Z", "CUSTOM_RETURN");
  client.updates = [{ status: "CUSTOM_RETURN", timestamp: "2026-09-29T12:00:00Z" }];
  assert.equal(collectReturns([stored([client])], { ...options, statuses: ["CUSTOM_RETURN"] }).content.length, 1);
  assert.equal(collectReturns([], options).metadata.complete, true);
  assert.throws(() => collectReturns([], { ...options, statuses: [] }));
});

test("SQLite selects each tour once across dates and isolates the distribution center", () => {
  const storage = new TourStorage(":memory:");
  try {
    const item = stored([visit("2026-09-29T12:00:00Z")]);
    storage.save(item.scope, item.summary, item.details);
    storage.save({ ...item.scope, date: "2026-09-29" }, item.summary, item.details);
    storage.save({ ...item.scope, distributionCenterId: "other" }, { ...item.summary, id: "other" }, null);
    const result = storage.listLatest(options.distributionCenterId);
    assert.equal(result.length, 1);
    assert.equal(result[0].scope.date, "2026-09-29");
    assert.equal(collectReturns(result, options).content.length, 1);
  } finally { storage.close(); }
});
