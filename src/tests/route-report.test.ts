import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createApiServer } from "../services/http-server.js";
import { HttpError, Operations } from "../services/operations.js";
import { buildRouteReport } from "../services/route-report.js";
import { TourStorage, type ScopedStoredTour } from "../services/storage.js";

function fixture(): ScopedStoredTour {
  return {
    scope: { date: "2026-09-30", distributionCenterId: "cd" },
    updatedAt: "2026-09-30T15:00:00Z",
    summary: {
      id: "internal",
      displayId: "00123",
      externalId: "ext",
      driverId: "driver",
      driverName: "Motorista",
      status: "IN_ROUTE",
      vehicle: { displayId: "truck", licensePlate: "ABC1234" },
      hasKeyAccount: false,
      overnight: false,
      searchTerms: [],
      visitsAmount: {
        concluded: 0,
        finalStatus: 0,
        inTreatment: 0,
        postponed: 0,
        rescheduled: 0,
        total: 3,
        unfulfilled: 0,
        waitingModulation: 0,
      },
    },
    details: {
      id: "internal",
      displayId: "00123",
      externalId: "ext",
      trips: [
        {
          id: "trip",
          displayId: "1",
          externalId: "trip",
          status: "IN_ROUTE",
          visits: [
            {
              accountId: "a",
              accountExternalId: "1",
              accountName: "A",
              status: "DELIVERED",
              tags: { outOfRadius: false },
              updatedAt: "2026-09-30T08:00:00-03:00",
              updates: [
                { status: "DELIVERED", timestamp: "2026-09-30T12:00:00Z" },
                { status: "ARRIVED", timestamp: "2026-09-30T10:00:00Z" },
              ],
            },
            {
              accountId: "b",
              accountExternalId: "2",
              accountName: "B",
              status: "DEFINITELY_RETURNED",
              tags: { outOfRadius: true },
              updatedAt: "2026-09-30T13:00:00Z",
            },
            {
              accountId: "a",
              accountExternalId: "1",
              accountName: "A",
              status: "PENDING",
              updatedAt: "invalid",
              updates: [
                { status: "PENDING", timestamp: "2026-09-30T12:00:00" },
              ],
            },
          ],
        },
      ],
    },
  };
}

test("route counts visits by status, unique clients, timestamps and three-state radius", () => {
  const result = buildRouteReport(fixture());
  assert.equal(result.tour.displayId, "00123");
  assert.equal(result.summary.totalVisits, 3);
  assert.equal(result.summary.totalClients, 2);
  assert.deepEqual(result.summary.countsByStatus, {
    DEFINITELY_RETURNED: 1,
    DELIVERED: 1,
    PENDING: 1,
  });
  assert.deepEqual(result.summary.radius, {
    inside: 1,
    outside: 1,
    unknown: 1,
  });
  assert.equal(result.clients[0].lastTimestamp, "2026-09-30T12:00:00.000Z");
  assert.equal(result.clients[0].withinRadius, true);
  assert.equal(result.clients[1].withinRadius, false);
  assert.equal(result.clients[2].lastTimestamp, null);
  assert.equal(result.clients[2].withinRadius, null);
  assert.equal(result.metadata.syncedAt, fixture().updatedAt);
});

test("missing details are not represented as zero clients; genuinely empty trips are valid", () => {
  const tour = fixture();
  tour.details = null;
  assert.throws(() => buildRouteReport(tour), /não sincronizados/);
  tour.details = { ...fixture().details!, trips: [] };
  assert.equal(buildRouteReport(tour).summary.totalVisits, 0);
});

test("display ID lookup preserves leading zeros, filters CD and date, detects ambiguity", () => {
  const storage = new TourStorage(":memory:");
  try {
    const tour = fixture();
    storage.save(tour.scope, tour.summary, tour.details);
    storage.save(
      { ...tour.scope, date: "2026-09-29" },
      tour.summary,
      tour.details,
    );
    storage.save(
      { ...tour.scope, distributionCenterId: "other" },
      tour.summary,
      tour.details,
    );
    assert.equal(storage.findByDisplayId("cd", "00123").length, 1);
    assert.equal(
      storage.findByDisplayId("cd", "00123")[0].scope.date,
      "2026-09-30",
    );
    assert.equal(
      storage.findByDisplayId("cd", "00123", "2026-09-29")[0].scope.date,
      "2026-09-29",
    );
    assert.equal(storage.findByDisplayId("cd", "123").length, 0);
    assert.equal(storage.findByDisplayId("cd", "internal").length, 0);
    storage.save(tour.scope, { ...tour.summary, id: "second" }, null);
    assert.equal(storage.findByDisplayId("cd", "00123").length, 2);
  } finally {
    storage.close();
  }
});

test("HTTP map route authenticates, validates, preserves errors and shares the operation lock", async () => {
  const operations = new Operations(":memory:", async () => ({}));
  let calls = 0;
  const server = createApiServer({
    apiKey: "secret",
    operations,
    getRoute: async (id, options) => {
      calls++;
      if (id === "404") throw new HttpError(404, "Mapa não encontrado.");
      assert.equal(id, "00123");
      assert.equal(options?.date, "2026-09-30");
      return buildRouteReport(fixture());
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const headers = { Authorization: "Bearer secret" };
  try {
    assert.equal((await fetch(base + "/rota/00123")).status, 401);
    assert.equal(calls, 0);
    const response = await fetch(base + "/rota/00123?date=2026-09-30", {
      headers,
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).summary.totalVisits, 3);
    assert.equal((await fetch(base + "/rota/404", { headers })).status, 404);
    assert.equal(
      (await fetch(base + "/rota/00123", { headers, method: "POST" })).status,
      405,
    );
    for (const url of [
      "/rota/abc",
      "/rota/%ZZ",
      "/rota/1?date=2026-02-30",
      "/rota/1?refresh=yes",
      "/rota/1?date=2026-09-30&date=2026-09-29",
      "/rota/1?unexpected=true",
    ]) {
      assert.equal((await fetch(base + url, { headers })).status, 400);
    }
    await operations.exclusive(async () => {
      assert.equal(
        (await fetch(base + "/rota/00123?refresh=true", { headers })).status,
        409,
      );
    });
    assert.equal(
      (
        await fetch(base + "/rota/00123?date=2026-09-30&refresh=true", {
          headers,
        })
      ).status,
      200,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    operations.close();
  }
});
