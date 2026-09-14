import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { Relay } from "../../src/core/relay.js";
import { listenHttp } from "../../src/http/server.js";
import { MemoryTransport } from "../../src/transport/memory.js";

describe("HTTP scaffold", () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => (error ? reject(error) : resolve()));
    });
    server = undefined;
  });

  async function start(relay?: Relay): Promise<string> {
    server = await listenHttp({ relay, port: 0, host: "127.0.0.1" });
    const address = server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
  }

  it("serves health and OpenAPI stub", async () => {
    const base = await start();
    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true });

    const spec = await fetch(`${base}/openapi.json`);
    expect(spec.status).toBe(200);
    const body = (await spec.json()) as { openapi: string };
    expect(body.openapi).toBe("3.1.0");
  });

  it("enqueues through the Day 4 stub when a relay is wired", async () => {
    const relay = new Relay({
      transport: new MemoryTransport(),
      handler: async () => "ok",
    });
    const base = await start(relay);
    const response = await fetch(`${base}/v1/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "echo", payload: { n: 1 }, idempotencyKey: "http-1" }),
    });
    expect(response.status).toBe(202);
    const body = (await response.json()) as { duplicate: boolean; job: { type: string } };
    expect(body.duplicate).toBe(false);
    expect(body.job.type).toBe("echo");
  });
});
