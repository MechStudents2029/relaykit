import { describe, expect, it } from "vitest";
import { InvalidTransitionError } from "../../src/core/errors.js";
import { canTransition, transition } from "../../src/core/status-machine.js";
import type { JobEnvelope } from "../../src/types/job.js";

function job(status: JobEnvelope["status"]): JobEnvelope {
  return {
    id: "j1",
    type: "demo",
    payload: {},
    idempotencyKey: "k1",
    status,
    attempt: 0,
    maxAttempts: 3,
    createdAt: 0,
    updatedAt: 0,
    availableAt: 0,
  };
}

describe("job status machine", () => {
  it("allows the happy-path transitions", () => {
    expect(canTransition("pending", "queued")).toBe(true);
    expect(canTransition("queued", "processing")).toBe(true);
    expect(canTransition("processing", "succeeded")).toBe(true);
  });

  it("rejects terminal escapes and skips", () => {
    expect(canTransition("succeeded", "queued")).toBe(false);
    expect(canTransition("pending", "succeeded")).toBe(false);
    expect(canTransition("dead_lettered", "processing")).toBe(false);
  });

  it("applies a legal transition and stamps updatedAt", () => {
    const next = transition(job("pending"), "queued", 42);
    expect(next.status).toBe("queued");
    expect(next.updatedAt).toBe(42);
  });

  it("throws on an illegal transition", () => {
    expect(() => transition(job("succeeded"), "failed", 1)).toThrow(InvalidTransitionError);
  });
});
