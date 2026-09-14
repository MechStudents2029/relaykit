import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { PermanentError, TransientError } from "../../src/core/errors.js";
import { Relay } from "../../src/core/relay.js";
import { OPENAPI_DOCUMENT } from "../../src/http/openapi.js";
import { listenHttp } from "../../src/http/server.js";
import { createMetricsRegistry } from "../../src/metrics/registry.js";
import { MemoryTransport } from "../../src/transport/memory.js";

describe("HTTP API", () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => (error ? reject(error) : resolve()));
    });
    server = undefined;
  });

  async function start(opts: Parameters<typeof listenHttp>[0] = {}): Promise<string> {
    server = await listenHttp({ ...opts, port: 0, host: "127.0.0.1" });
    const address = server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
  }

  it("serves health and OpenAPI with the documented routes", async () => {
    const base = await start();
    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, service: "relaykit" });

    const spec = await fetch(`${base}/openapi.json`);
    expect(spec.status).toBe(200);
    const body = (await spec.json()) as typeof OPENAPI_DOCUMENT;
    expect(body.openapi).toBe("3.1.0");
    expect(body.paths["/v1/jobs"].post).toBeDefined();
    expect(body.paths["/v1/jobs/{id}"].get).toBeDefined();
    expect(body.paths["/v1/dlq"].get).toBeDefined();
    expect(body.components.securitySchemes.apiKey).toBeDefined();
  });

  it("enqueues, returns status, and suppresses duplicates", async () => {
    const metrics = createMetricsRegistry();
    const relay = new Relay({
      transport: new MemoryTransport(),
      metrics,
      handler: async () => "ok",
    });
    const base = await start({ relay, metrics });
    const response = await fetch(`${base}/v1/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "echo", payload: { n: 1 }, idempotencyKey: "http-1" }),
    });
    expect(response.status).toBe(202);
    const created = (await response.json()) as { duplicate: boolean; job: { id: string; status: string } };
    expect(created.duplicate).toBe(false);
    expect(created.job.status).toBe("queued");

    const status = await fetch(`${base}/v1/jobs/${created.job.id}`);
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ id: created.job.id, type: "echo" });

    const dup = await fetch(`${base}/v1/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "echo", payload: { n: 9 }, idempotencyKey: "http-1" }),
    });
    expect(dup.status).toBe(200);
    const dupBody = (await dup.json()) as { duplicate: boolean; job: { id: string } };
    expect(dupBody.duplicate).toBe(true);
    expect(dupBody.job.id).toBe(created.job.id);
    expect(metrics.duplicates).toBe(1);
  });

  it("returns 404 for unknown jobs and 400 for bad enqueue bodies", async () => {
    const relay = new Relay({
      transport: new MemoryTransport(),
      handler: async () => "ok",
    });
    const base = await start({ relay });
    expect((await fetch(`${base}/v1/jobs/does-not-exist`)).status).toBe(404);

    const missingKey = await fetch(`${base}/v1/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "echo" }),
    });
    expect(missingKey.status).toBe(400);

    const invalidJson = await fetch(`${base}/v1/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(invalidJson.status).toBe(400);
  });

  it("lists dead-lettered jobs", async () => {
    const relay = new Relay({
      transport: new MemoryTransport(),
      retry: { baseDelayMs: 0, maxDelayMs: 0, jitter: "none" },
      handler: async () => {
        throw new TransientError("always down");
      },
    });
    const base = await start({ relay });
    const enqueued = await fetch(`${base}/v1/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "doomed", payload: {}, idempotencyKey: "dlq-http", maxAttempts: 2 }),
    });
    const { job } = (await enqueued.json()) as { job: { id: string } };
    await relay.drain(5);

    const dlq = await fetch(`${base}/v1/dlq`);
    expect(dlq.status).toBe(200);
    const body = (await dlq.json()) as { count: number; jobs: Array<{ id: string; status: string }> };
    expect(body.count).toBe(1);
    expect(body.jobs[0]?.id).toBe(job.id);
    expect(body.jobs[0]?.status).toBe("dead_lettered");
  });

  it("requires the local API key when configured", async () => {
    const relay = new Relay({
      transport: new MemoryTransport(),
      handler: async () => "ok",
    });
    const base = await start({ relay, apiKey: "demo-local-key" });

    expect((await fetch(`${base}/health`)).status).toBe(200);
    expect((await fetch(`${base}/v1/jobs`, { method: "POST", body: "{}" })).status).toBe(401);

    const wrong = await fetch(`${base}/v1/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "nope" },
      body: JSON.stringify({ type: "echo", payload: {}, idempotencyKey: "k" }),
    });
    expect(wrong.status).toBe(401);

    const ok = await fetch(`${base}/v1/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer demo-local-key" },
      body: JSON.stringify({ type: "echo", payload: {}, idempotencyKey: "k" }),
    });
    expect(ok.status).toBe(202);
  });

  it("exposes live metrics after processing and a permanent failure", async () => {
    const metrics = createMetricsRegistry();
    let calls = 0;
    const relay = new Relay({
      transport: new MemoryTransport(),
      metrics,
      retry: { baseDelayMs: 0, maxDelayMs: 0, jitter: "none" },
      handler: async () => {
        calls += 1;
        if (calls === 1) {
          throw new PermanentError("bad");
        }
        return "ok";
      },
    });
    const base = await start({ relay, metrics });
    await fetch(`${base}/v1/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "a", payload: {}, idempotencyKey: "m1" }),
    });
    await fetch(`${base}/v1/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "b", payload: {}, idempotencyKey: "m2" }),
    });
    expect(await relay.pendingLag()).toBe(2);
    await relay.drain(5);

    const text = await (await fetch(`${base}/metrics`)).text();
    expect(text).toContain("relaykit_jobs_processed_total 1");
    expect(text).toContain("relaykit_jobs_failed_total 1");
    expect(text).toContain("relaykit_consumer_lag 0");
  });
});
