import { describe, expect, it } from "vitest";
import { ManualClock } from "../../src/core/clock.js";
import { CircuitOpenError } from "../../src/core/errors.js";
import { CircuitBreaker } from "../../src/resilience/circuit-breaker.js";

describe("circuit breaker", () => {
  it("opens after the failure threshold and rejects immediately", async () => {
    const clock = new ManualClock(0);
    const breaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeoutMs: 1_000,
      clock,
    });

    for (let i = 0; i < 3; i += 1) {
      await expect(
        breaker.exec(async () => {
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
    }

    expect(breaker.getState()).toBe("open");
    await expect(breaker.exec(async () => "ok")).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it("moves to half-open after the reset timeout and closes on success", async () => {
    const clock = new ManualClock(0);
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 50,
      clock,
    });

    await expect(
      breaker.exec(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(breaker.getState()).toBe("open");

    clock.advance(50);
    expect(breaker.getState()).toBe("half_open");
    await expect(breaker.exec(async () => "recovered")).resolves.toBe("recovered");
    expect(breaker.getState()).toBe("closed");
  });
});
