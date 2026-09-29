import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApiServer } from "../services/http-server.js";
import { collectReturns } from "../services/returns.js";

const report = { ...collectReturns([], { date: "2026-09-29", timezone: "America/Fortaleza",
  distributionCenterId: "0730882", statuses: ["DEFINITELY_RETURNED"] }), failures: [] };
const complete = { ...report, metadata: { ...report.metadata, source: "sqlite" } };

async function withServer(options: Parameters<typeof createApiServer>[0], action: (base: string) => Promise<void>) {
  const server = createApiServer(options);
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try { await action(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); }
  finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

test("HTTP returns JSON from SQLite by default and validates route/method/query", async () => {
  await withServer({ getReturns: async (options) => { assert.equal(options?.offline, true); return complete; } }, async (base) => {
    const response = await fetch(`${base}/returns/today`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type")!, /application\/json/);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), complete);
    assert.equal((await fetch(`${base}/missing`)).status, 404);
    const post = await fetch(`${base}/returns/today`, { method: "POST" });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get("allow"), "GET");
    for (const query of ["refresh=1", "date=2026-09-29", "refresh=true&refresh=false"]) {
      assert.equal((await fetch(`${base}/returns/today?${query}`)).status, 400);
    }
  });
});

test("configured Bearer key is required before accessing the report", async () => {
  let calls = 0;
  await withServer({ apiKey: "test-key", getReturns: async () => { calls++; return complete; } }, async (base) => {
    assert.equal((await fetch(`${base}/returns/today`)).status, 401);
    assert.equal((await fetch(`${base}/returns/today`, { headers: { Authorization: "Bearer incorrect" } })).status, 401);
    assert.equal(calls, 0);
    assert.equal((await fetch(`${base}/returns/today`, { headers: { Authorization: "Bearer test-key" } })).status, 200);
    assert.equal(calls, 1);
  });
});

test("simultaneous refresh requests share one refresh and allow later refreshes", async () => {
  let calls = 0;
  let release!: () => void;
  let started!: () => void;
  const began = new Promise<void>((resolve) => { started = resolve; });
  await withServer({ getReturns: async (options) => {
    assert.equal(options?.offline, false);
    assert.equal(options?.headless, true);
    calls++;
    if (calls === 1) { started(); await new Promise<void>((resolve) => { release = resolve; }); }
    return complete;
  } }, async (base) => {
    const first = fetch(`${base}/returns/today?refresh=true`);
    await began;
    const second = fetch(`${base}/returns/today?refresh=true`);
    // Give the second local HTTP request time to reach the in-flight promise.
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();
    assert.deepEqual((await Promise.all([first, second])).map((response) => response.status), [200, 200]);
    assert.equal(calls, 1);
    assert.equal((await fetch(`${base}/returns/today?refresh=true`)).status, 200);
    assert.equal(calls, 2);
  });
});

test("incomplete data and unexpected failures do not return success", async () => {
  await withServer({ getReturns: async () => ({ ...complete, metadata: { ...complete.metadata, complete: false } }) }, async (base) => {
    const response = await fetch(`${base}/returns/today`);
    assert.equal(response.status, 502);
    assert.equal((await response.json()).metadata.complete, false);
  });
  await withServer({ getReturns: async () => { throw new Error("upstream failed"); } }, async (base) => {
    const response = await fetch(`${base}/returns/today`);
    assert.equal(response.status, 500);
    assert.equal((await response.json()).error, "RETURNS_QUERY_FAILED");
  });
});
