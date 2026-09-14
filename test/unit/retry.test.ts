import { describe, expect, it } from "vitest";
import { computeBackoff, shouldRetry } from "../../src/resilience/retry.js";

describe("retry backoff", () => {
  it("grows exponentially without jitter", () => {
    const policy = { baseDelayMs: 100, maxDelayMs: 10_000, jitter: "none" as const };
    expect(computeBackoff(1, policy)).toBe(100);
    expect(computeBackoff(2, policy)).toBe(200);
    expect(computeBackoff(3, policy)).toBe(400);
    expect(computeBackoff(8, policy)).toBe(10_000);
  });

  it("applies full jitter with a deterministic rng", () => {
    const policy = {
      baseDelayMs: 100,
      maxDelayMs: 10_000,
      jitter: "full" as const,
      random: () => 0.5,
    };
    expect(computeBackoff(1, policy)).toBe(50);
    expect(computeBackoff(3, policy)).toBe(200);
  });

  it("applies equal jitter with a deterministic rng", () => {
    const policy = {
      baseDelayMs: 100,
      maxDelayMs: 10_000,
      jitter: "equal" as const,
      random: () => 0.5,
    };
    expect(computeBackoff(1, policy)).toBe(75);
  });

  it("stops retrying after max attempts or permanent errors", () => {
    expect(shouldRetry(2, 5, true)).toBe(true);
    expect(shouldRetry(5, 5, true)).toBe(false);
    expect(shouldRetry(1, 5, false)).toBe(false);
  });
});
