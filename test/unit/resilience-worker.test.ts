import { describe, expect, it } from "vitest";
import { ManualClock } from "../../src/core/clock.js";
import { PermanentError, TransientError } from "../../src/core/errors.js";
import { Relay } from "../../src/core/relay.js";
import { CircuitBreaker } from "../../src/resilience/circuit-breaker.js";
import { MemoryTransport } from "../../src/transport/memory.js";

describe("resilience worker", () => {
  it("retries transient failures with backoff then succeeds", async () => {
    const clock = new ManualClock(0);
    const transport = new MemoryTransport({ clock });
    const attempts: number[] = [];
    const relay = new Relay({
      transport,
      clock,
      retry: { baseDelayMs: 10, maxDelayMs: 10, jitter: "none" },
      handler: async (job) => {
        attempts.push(job.attempt);
        if (job.attempt < 3) {
          throw new TransientError("flaky");
        }
        return "ok";
      },
    });

    const { job } = await relay.enqueue({
      type: "flaky",
      payload: {},
      idempotencyKey: "retry-1",
      maxAttempts: 5,
    });

    expect(await relay.worker.processNext()).toMatchObject({ status: "queued" });
    expect((await relay.getJob(job.id))?.status).toBe("queued");
    expect((await relay.getJob(job.id))?.availableAt).toBe(10);

    clock.advance(10);
    expect(await relay.worker.processNext()).toMatchObject({ status: "queued" });
    clock.advance(10);
    const done = await relay.worker.processNext();
    expect(done?.status).toBe("succeeded");
    expect(attempts).toEqual([1, 2, 3]);
  });

  it("dead-letters a job after exhausting retries", async () => {
    const transport = new MemoryTransport();
    const relay = new Relay({
      transport,
      retry: { baseDelayMs: 0, maxDelayMs: 0, jitter: "none" },
      handler: async () => {
        throw new TransientError("always down");
      },
    });

    const { job } = await relay.enqueue({
      type: "doomed",
      payload: {},
      idempotencyKey: "dlq-1",
      maxAttempts: 2,
    });

    await relay.drain(5);
    const finalJob = await relay.getJob(job.id);
    expect(finalJob?.status).toBe("dead_lettered");
    expect(finalJob?.attempt).toBe(2);
    expect(await relay.dlq.size()).toBe(1);
  });

  it("fails permanently without retrying", async () => {
    const transport = new MemoryTransport();
    const relay = new Relay({
      transport,
      retry: { baseDelayMs: 0, maxDelayMs: 0, jitter: "none" },
      handler: async () => {
        throw new PermanentError("bad payload");
      },
    });

    const { job } = await relay.enqueue({
      type: "bad",
      payload: {},
      idempotencyKey: "perm-1",
      maxAttempts: 5,
    });

    await relay.drain();
    expect((await relay.getJob(job.id))?.status).toBe("failed");
    expect(await relay.dlq.size()).toBe(0);
  });

  it("stops claiming while the circuit is open", async () => {
    const clock = new ManualClock(0);
    const transport = new MemoryTransport({ clock });
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 100, clock });
    const relay = new Relay({
      transport,
      clock,
      breaker,
      retry: { baseDelayMs: 0, maxDelayMs: 0, jitter: "none" },
      handler: async () => {
        throw new TransientError("trip");
      },
    });

    await relay.enqueue({
      type: "x",
      payload: {},
      idempotencyKey: "cb-1",
      maxAttempts: 5,
    });
    await relay.enqueue({
      type: "x",
      payload: {},
      idempotencyKey: "cb-2",
      maxAttempts: 5,
    });

    const first = await relay.worker.processNext();
    expect(first?.status).toBe("queued");
    expect(first?.lastError).toBe("trip");
    expect(breaker.getState()).toBe("open");

    const skipped = await relay.worker.processNext();
    expect(skipped).toBeUndefined();
    expect(await transport.claim(0)).toBeDefined();
  });
});
