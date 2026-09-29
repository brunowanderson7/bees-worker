import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { TourStorage } from "../services/storage.js";
import { synchronizeTours } from "../services/sync-tours.js";
import { compareTour } from "../services/compare-tours.js";
import { migrateLegacyData } from "../services/migrate-legacy.js";
import type { BeesTourSummary } from "../types/tours.js";
import type { BeesTourDetailsResponse } from "../types/tour-details.js";

const scope = { date: "2026-09-29", distributionCenterId: "0730882" };
function tour(id = "one", status = "IN_ROUTE"): BeesTourSummary {
  return {
    id, externalId: id, displayId: id, driverId: "driver", driverName: "Driver",
    vehicle: { displayId: "vehicle", licensePlate: "ABC1234" },
    hasKeyAccount: false, overnight: false, status, searchTerms: [],
    visitsAmount: { concluded: 0, finalStatus: 0, inTreatment: 0, postponed: 0,
      rescheduled: 0, total: 1, unfulfilled: 0, waitingModulation: 0 },
  };
}
function details(id: string): BeesTourDetailsResponse {
  return { id, displayId: id, externalId: id, trips: [] };
}

test("new, unchanged and changed tours fetch only the necessary details", async () => {
  const storage = new TourStorage(":memory:");
  try {
    const calls: string[] = [];
    const fetch = async (id: string) => { calls.push(id); return details(id); };
    const first = await synchronizeTours(storage, scope, [tour(), tour("two")], fetch);
    assert.equal(first.updated, 2);
    assert.equal(first.changes[0].changes[0].field, "$new");
    calls.length = 0;
    const unchanged = await synchronizeTours(storage, scope, [tour(), tour("two")], fetch);
    assert.equal(unchanged.unchanged, 2);
    assert.deepEqual(calls, []);
    const changed = { ...tour(), lastUpdateTimestamp: "2026-09-29T12:00:00Z" };
    await synchronizeTours(storage, scope, [changed, tour("two")], fetch);
    assert.deepEqual(calls, ["one"]);
    assert.deepEqual(storage.get(scope, "one")?.summary, changed);
    assert.equal(storage.readChanges(scope).length, 3);
  } finally { storage.close(); }
});

test("failed detail requests retain old state, continue other tours and retry", async () => {
  const storage = new TourStorage(":memory:");
  try {
    storage.save(scope, tour(), details("one"));
    const changed = { ...tour(), driverName: "New driver" };
    const failed = await synchronizeTours(storage, scope, [changed, tour("two")], async (id) => {
      if (id === "one") throw new Error("HTTP 503");
      return details(id);
    });
    assert.equal(failed.failures.length, 1);
    assert.equal(failed.updated, 1);
    assert.equal(storage.get(scope, "one")?.summary.driverName, "Driver");
    const retried = await synchronizeTours(storage, scope, [changed], async (id) => details(id));
    assert.equal(retried.updated, 1);
    assert.equal(storage.get(scope, "one")?.summary.driverName, "New driver");
  } finally { storage.close(); }
});

test("missing details, forced refresh, and invalid details", async () => {
  const storage = new TourStorage(":memory:");
  try {
    storage.save(scope, tour(), null);
    assert.equal((await synchronizeTours(storage, scope, [tour()], async (id) => details(id))).updated, 1);
    assert.equal((await synchronizeTours(storage, scope, [tour()], async (id) => details(id), "one")).updated, 1);
    const changed = { ...tour(), status: "FINISHED" };
    const invalid = await synchronizeTours(storage, scope, [changed], async () => details("wrong"));
    assert.equal(invalid.failures.length, 1);
    assert.equal(storage.get(scope, "one")?.summary.status, "IN_ROUTE");
  } finally { storage.close(); }
});

test("comparison detects nested fields and ignores object key ordering", () => {
  const original = tour();
  const reordered = { ...original, vehicle: { licensePlate: "ABC1234", displayId: "vehicle" } };
  assert.equal(compareTour(original, reordered), null);
  const result = compareTour(original, { ...original, vehicle: { ...original.vehicle, licensePlate: "NEW1234" } });
  assert.equal(result?.changes[0].field, "vehicle.licensePlate");
});

test("cleanup cascades history and details, preserves active/canceled and other scopes", async () => {
  const storage = new TourStorage(":memory:");
  try {
    const other = { ...scope, date: "2026-09-28" };
    const otherCenter = { ...scope, distributionCenterId: "other" };
    await synchronizeTours(storage, scope, [tour("done", "FINISHED"), tour("closed", "CLOSED"),
      tour("post", "POST_ROUTE"), tour("active"), tour("canceled", "CANCELED")], async (id) => details(id));
    storage.save(other, tour("done", "FINISHED"), details("done"));
    storage.save(otherCenter, tour("done", "CLOSED"), details("done"));
    assert.equal(storage.removeFinalized(scope), 3);
    assert.equal(storage.get(scope, "done"), null);
    assert.equal(storage.readChanges(scope).length, 2);
    assert.equal(storage.list(scope).length, 2);
    assert.ok(storage.get(other, "done"));
    assert.ok(storage.get(otherCenter, "done"));
    assert.equal(storage.removeFinalized(), 2);
    assert.equal(storage.removeFinalized(), 0);
  } finally { storage.close(); }
});

test("empty response does not delete stored tours; duplicate IDs fail before writes", async () => {
  const storage = new TourStorage(":memory:");
  try {
    storage.save(scope, tour(), details("one"));
    await synchronizeTours(storage, scope, [], async (id) => details(id));
    assert.equal(storage.list(scope).length, 1);
    await assert.rejects(synchronizeTours(storage, scope, [tour("two"), tour("two")], async (id) => details(id)));
    assert.equal(storage.get(scope, "two"), null);
  } finally { storage.close(); }
});

test("legacy import survives reopen, is idempotent and preserves existing SQLite records", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bees-sqlite-test-"));
  try {
    await mkdir(path.join(dir, "tours"));
    await mkdir(path.join(dir, "tour-details"));
    await writeFile(path.join(dir, "tours", "current.json"),
      JSON.stringify({ metadata: scope, content: [tour(), tour("two")] }));
    await writeFile(path.join(dir, "tour-details", "one.json"), JSON.stringify({ content: details("one") }));
    const filename = path.join(dir, "test.sqlite");
    const first = new TourStorage(filename);
    try {
      first.save(scope, { ...tour("two"), driverName: "Keep me" }, details("two"));
      assert.equal(await migrateLegacyData(first, dir), 1);
    } finally { first.close(); }
    const reopened = new TourStorage(filename);
    try {
      assert.equal(await migrateLegacyData(reopened, dir), 0);
      assert.deepEqual(reopened.get(scope, "one")?.details, details("one"));
      assert.equal(reopened.get(scope, "two")?.summary.driverName, "Keep me");
    } finally { reopened.close(); }
  } finally {
    // Only remove the uniquely created test directory inside the OS temp root.
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(tmpdir()));
    assert.ok(path.basename(dir).startsWith("bees-sqlite-test-"));
    await rm(dir, { recursive: true, force: true });
  }
});
