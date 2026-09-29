import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { BrowserContext } from "playwright";
import type { AddressInfo } from "node:net";
import { Operations, validateJob } from "../services/operations.js";
import { createApiServer } from "../services/http-server.js";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

async function idle(operations: Operations) {
  for (let i = 0; i < 100 && operations.status().active; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(operations.status().active, null);
}

test("validates allowlisted jobs and fixes cleanup to a single date", () => {
  assert.match(validateJob({ type: "remove:finalized" }).date!, /^\d{4}-\d{2}-\d{2}$/);
  for (const value of [{ type: "exec", command: "ls" }, { type: "sync:tour" },
    { type: "sync:tours", date: "2026-02-30" }, { type: "returns:today", date: "2026-09-29" },
    { type: "sync:tours", command: "anything" }, { type: "sync:tours", tourId: "x" }]) {
    assert.throws(() => validateJob(value));
  }
});

test("jobs reject overlaps, persist results, and release the lock on failure", async () => {
  let release!: () => void;
  const operations = new Operations(":memory:", async () => {
    await new Promise<void>((resolve) => { release = resolve; });
    return { removed: 3 };
  });
  try {
    const job = operations.startJob(validateJob({ type: "remove:finalized" }));
    assert.equal(operations.getJob(job.id).state, "running");
    assert.throws(() => operations.startJob(validateJob({ type: "sync:tours" })), /andamento/);
    await Promise.resolve(); release(); await idle(operations);
    assert.equal(operations.getJob(job.id).state, "succeeded");
    assert.deepEqual(operations.getJob(job.id).result, { removed: 3 });
  } finally { operations.close(); }
  const failing = new Operations(":memory:", async () => { throw new Error("failure"); });
  try {
    const job = failing.startJob(validateJob({ type: "sync:tours" }));
    await idle(failing);
    assert.equal(failing.getJob(job.id).state, "failed");
  } finally { failing.close(); }
});

test("login blocks automation until closed; failed launch releases the lock", async () => {
  const context = new EventEmitter() as EventEmitter & { pages: () => unknown[]; close: () => Promise<void> };
  context.pages = () => [{ goto: async () => {} }];
  context.close = async () => { context.emit("close"); };
  const operations = new Operations(":memory:", async () => ({}), async () => context as unknown as BrowserContext);
  try {
    assert.equal((await operations.openLogin()).loginOpen, true);
    await assert.rejects(operations.exclusive(async () => ({})), /andamento/);
    assert.throws(() => operations.startJob(validateJob({ type: "sync:tours" })), /andamento/);
    await operations.closeLogin();
    assert.equal(operations.status().active, null);
  } finally { operations.close(); }
  const failing = new Operations(":memory:", async () => ({}), async () => { throw new Error("launch failed"); });
  try {
    await assert.rejects(failing.openLogin(), /launch failed/);
    assert.equal(failing.status().active, null);
  } finally { failing.close(); }
});

test("job and browser HTTP routes require auth and return pollable job results", async () => {
  const operations = new Operations(":memory:", async () => ({ updated: 2 }));
  const server = createApiServer({ apiKey: "test-token", operations });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const headers = { Authorization: "Bearer test-token", "Content-Type": "application/json" };
  try {
    for (const route of ["/jobs", "/browser/login", "/browser/close", "/browser/status", "/jobs/unknown"]) {
      assert.equal((await fetch(base + route, { method: route === "/browser/status" ? "GET" : "POST" })).status, 401);
    }
    assert.equal((await fetch(base + "/health")).status, 200);
    const response = await fetch(base + "/jobs", { method: "POST", headers, body: JSON.stringify({ type: "sync:tours" }) });
    assert.equal(response.status, 202);
    const job = await response.json();
    await idle(operations);
    const result = await fetch(base + job.statusUrl, { headers });
    assert.equal((await result.json()).state, "succeeded");
    assert.equal((await fetch(base + "/jobs", { method: "POST", headers, body: "broken" })).status, 400);
    assert.equal((await fetch(base + "/jobs", { method: "POST", headers, body: '{"type":"shell"}' })).status, 400);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    operations.close();
  }
});

test("jobs survive reopening and incomplete runs become interrupted", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bees-jobs-test-"));
  const filename = path.join(dir, "jobs.sqlite");
  try {
    const first = new Operations(filename, async () => ({ metadata: { complete: false }, content: [] }));
    const job = first.startJob(validateJob({ type: "returns:today" }));
    await idle(first);
    assert.equal(first.getJob(job.id).state, "partial");
    first.close();
    const db = new DatabaseSync(filename);
    db.prepare("INSERT INTO jobs (id,type,state,input_json,created_at) VALUES ('unfinished','sync:tours','running','{}',?)")
      .run(new Date().toISOString());
    db.close();
    const reopened = new Operations(filename);
    try {
      assert.equal(reopened.getJob(job.id).state, "partial");
      assert.equal(reopened.getJob("unfinished").state, "interrupted");
    } finally { reopened.close(); }
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(tmpdir()));
    assert.ok(path.basename(dir).startsWith("bees-jobs-test-"));
    await rm(dir, { recursive: true, force: true });
  }
});
