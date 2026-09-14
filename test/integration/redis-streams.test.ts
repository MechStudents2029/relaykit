import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { Relay } from "../../src/core/relay.js";
import { TransientError } from "../../src/core/errors.js";
import { redisAvailable, RedisStreamsTransport } from "../../src/redis/streams.js";

const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const available = await redisAvailable(redisUrl);

describe.skipIf(!available)("Redis Streams transport", () => {
  const transports: RedisStreamsTransport[] = [];

  afterEach(async () => {
    await Promise.all(transports.splice(0).map((t) => t.close()));
  });

  function createTransport(): RedisStreamsTransport {
    const transport = new RedisStreamsTransport({
      url: redisUrl,
      prefix: `relaykit-itest-${randomUUID()}`,
      blockMs: 200,
    });
    transports.push(transport);
    return transport;
  }

  it("produces, claims, and completes a job via a consumer group", async () => {
    const transport = createTransport();
    const { job, duplicate } = await transport.enqueue({
      type: "echo",
      payload: { n: 3 },
      idempotencyKey: "redis-happy",
    });
    expect(duplicate).toBe(false);

    const claimed = await transport.claim(500);
    expect(claimed?.id).toBe(job.id);
    expect(claimed?.status).toBe("processing");
    expect(claimed?.attempt).toBe(1);

    const done = await transport.complete(claimed!, { ok: true });
    expect(done.status).toBe("succeeded");
    expect(await transport.claim(50)).toBeUndefined();
  });

  it("suppresses duplicate idempotency keys across Redis", async () => {
    const transport = createTransport();
    const first = await transport.enqueue({
      type: "echo",
      payload: { n: 1 },
      idempotencyKey: "redis-dup",
    });
    const second = await transport.enqueue({
      type: "echo",
      payload: { n: 2 },
      idempotencyKey: "redis-dup",
    });
    expect(second.duplicate).toBe(true);
    expect(second.job.id).toBe(first.job.id);

    const relay = new Relay({
      transport,
      retry: { baseDelayMs: 0, maxDelayMs: 0, jitter: "none" },
      handler: async () => "ok",
    });
    expect(await relay.drain(5)).toBe(1);
    expect((await relay.getJob(first.job.id))?.status).toBe("succeeded");
  });

  it("retries then dead-letters through delayed ZSET + DLQ stream", async () => {
    const transport = createTransport();
    const relay = new Relay({
      transport,
      retry: { baseDelayMs: 0, maxDelayMs: 0, jitter: "none" },
      handler: async () => {
        throw new TransientError("redis flake");
      },
    });

    const { job } = await transport.enqueue({
      type: "doomed",
      payload: {},
      idempotencyKey: "redis-dlq",
      maxAttempts: 2,
    });

    await relay.drain(6);
    const finalJob = await relay.getJob(job.id);
    expect(finalJob?.status).toBe("dead_lettered");
    expect(await relay.dlq.size()).toBe(1);
  });
});

describe.runIf(!available)("Redis Streams transport (unavailable)", () => {
  it("skips gracefully when Redis is down — run `npm run docker:up` then `npm run test:integration`", () => {
    expect(available).toBe(false);
  });
});
