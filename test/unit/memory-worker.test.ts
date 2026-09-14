import { describe, expect, it } from "vitest";
import { ManualClock } from "../../src/core/clock.js";
import { Relay } from "../../src/core/relay.js";
import { MemoryTransport } from "../../src/transport/memory.js";

describe("in-memory relay", () => {
  it("processes a job through to succeeded (happy path)", async () => {
    const clock = new ManualClock(1_000);
    const transport = new MemoryTransport({ clock });
    let calls = 0;
    const relay = new Relay({
      transport,
      clock,
      retry: { baseDelayMs: 0, maxDelayMs: 0, jitter: "none" },
      handler: async (job) => {
        calls += 1;
        return { ok: true, n: (job.payload as { n: number }).n };
      },
    });

    const { job, duplicate } = await relay.enqueue({
      type: "echo",
      payload: { n: 7 },
      idempotencyKey: "happy-1",
    });
    expect(duplicate).toBe(false);
    expect(job.status).toBe("queued");

    const processed = await relay.drain();
    expect(processed).toBe(1);
    expect(calls).toBe(1);

    const finalJob = await relay.getJob(job.id);
    expect(finalJob?.status).toBe("succeeded");
    expect(finalJob?.attempt).toBe(1);
    expect(finalJob?.result).toEqual({ ok: true, n: 7 });
  });

  it("suppresses duplicates by idempotency key and runs the handler once", async () => {
    const transport = new MemoryTransport();
    let calls = 0;
    const relay = new Relay({
      transport,
      retry: { baseDelayMs: 0, maxDelayMs: 0, jitter: "none" },
      handler: async () => {
        calls += 1;
        return "done";
      },
    });

    const first = await relay.enqueue({
      type: "echo",
      payload: { n: 1 },
      idempotencyKey: "same-key",
    });
    const second = await relay.enqueue({
      type: "echo",
      payload: { n: 2 },
      idempotencyKey: "same-key",
    });

    expect(second.duplicate).toBe(true);
    expect(second.job.id).toBe(first.job.id);
    expect(transport.size()).toBe(1);

    await relay.drain();
    expect(calls).toBe(1);

    const again = await relay.enqueue({
      type: "echo",
      payload: { n: 3 },
      idempotencyKey: "same-key",
    });
    expect(again.duplicate).toBe(true);
    await relay.drain();
    expect(calls).toBe(1);
  });
});
