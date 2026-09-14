import { CircuitOpenError } from "../core/errors.js";
import type { Clock } from "../core/clock.js";
import { systemClock } from "../core/clock.js";

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  resetTimeoutMs?: number;
  halfOpenMax?: number;
  clock?: Clock;
}

export class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly halfOpenMax: number;
  private readonly clock: Clock;
  private state: CircuitState = "closed";
  private failures = 0;
  private openedAt = 0;
  private halfOpenProbes = 0;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 1_000;
    this.halfOpenMax = options.halfOpenMax ?? 1;
    this.clock = options.clock ?? systemClock;
  }

  getState(): CircuitState {
    this.refresh();
    return this.state;
  }

  isOpen(): boolean {
    return this.getState() === "open";
  }

  reopenAt(): number {
    return this.openedAt + this.resetTimeoutMs;
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    this.refresh();
    if (this.state === "open") {
      throw new CircuitOpenError(this.reopenAt());
    }
    if (this.state === "half_open") {
      if (this.halfOpenProbes >= this.halfOpenMax) {
        throw new CircuitOpenError(this.reopenAt());
      }
      this.halfOpenProbes += 1;
    }
    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  recordSuccess(): void {
    this.refresh();
    this.failures = 0;
    this.halfOpenProbes = 0;
    this.state = "closed";
  }

  recordFailure(): void {
    this.refresh();
    this.failures += 1;
    if (this.state === "half_open" || this.failures >= this.failureThreshold) {
      this.trip();
    }
  }

  private trip(): void {
    this.state = "open";
    this.openedAt = this.clock.now();
    this.halfOpenProbes = 0;
  }

  private refresh(): void {
    if (this.state === "open" && this.clock.now() >= this.reopenAt()) {
      this.state = "half_open";
      this.halfOpenProbes = 0;
    }
  }
}
