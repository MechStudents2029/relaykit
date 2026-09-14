import type { Clock } from "./clock.js";
import { systemClock } from "./clock.js";
import { CircuitOpenError, isRetryable } from "./errors.js";
import type { CircuitBreaker } from "../resilience/circuit-breaker.js";
import type { Bulkhead } from "../resilience/bulkhead.js";
import { computeBackoff, type RetryPolicy } from "../resilience/retry.js";
import type { JobEnvelope } from "../types/job.js";
import type { Transport } from "../transport/types.js";

export type JobHandler<T = unknown> = (job: JobEnvelope<T>) => Promise<unknown> | unknown;

export type WorkerEvent =
  | { type: "claimed"; job: JobEnvelope }
  | { type: "succeeded"; job: JobEnvelope }
  | { type: "retrying"; job: JobEnvelope; delayMs: number }
  | { type: "failed"; job: JobEnvelope }
  | { type: "dead_lettered"; job: JobEnvelope }
  | { type: "circuit_open"; reopenAt: number };

export interface WorkerOptions {
  transport: Transport;
  handler: JobHandler;
  clock?: Clock;
  retry?: RetryPolicy;
  breaker?: CircuitBreaker;
  bulkhead?: Bulkhead;
  pollIntervalMs?: number;
  onEvent?: (event: WorkerEvent) => void;
}

const DEFAULT_RETRY: RetryPolicy = {
  baseDelayMs: 100,
  maxDelayMs: 10_000,
  jitter: "full",
};

export class Worker {
  private readonly transport: Transport;
  private readonly handler: JobHandler;
  private readonly clock: Clock;
  private readonly retry: RetryPolicy;
  private readonly breaker?: CircuitBreaker;
  private readonly bulkhead?: Bulkhead;
  private readonly pollIntervalMs: number;
  private readonly onEvent?: (event: WorkerEvent) => void;
  private running = false;
  private loop?: Promise<void>;

  constructor(options: WorkerOptions) {
    this.transport = options.transport;
    this.handler = options.handler;
    this.clock = options.clock ?? systemClock;
    this.retry = options.retry ?? DEFAULT_RETRY;
    this.breaker = options.breaker;
    this.bulkhead = options.bulkhead;
    this.pollIntervalMs = options.pollIntervalMs ?? 25;
    this.onEvent = options.onEvent;
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.loop = this.runLoop();
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.loop;
  }

  async drain(maxJobs = 100): Promise<number> {
    let processed = 0;
    for (let i = 0; i < maxJobs; i += 1) {
      const job = await this.processNext(0);
      if (!job) {
        break;
      }
      processed += 1;
    }
    return processed;
  }

  async processNext(blockMs = 0): Promise<JobEnvelope | undefined> {
    if (this.breaker?.isOpen()) {
      const reopenAt = this.breaker.reopenAt();
      this.onEvent?.({ type: "circuit_open", reopenAt });
      return undefined;
    }

    const claimed = await this.transport.claim(blockMs);
    if (!claimed) {
      return undefined;
    }
    this.onEvent?.({ type: "claimed", job: claimed });

    try {
      const result = await this.execute(claimed);
      const completed = await this.transport.complete(claimed, result);
      this.onEvent?.({ type: "succeeded", job: completed });
      return completed;
    } catch (error) {
      return this.handleFailure(claimed, error);
    }
  }

  private async execute(job: JobEnvelope): Promise<unknown> {
    const run = async (): Promise<unknown> => {
      if (this.breaker) {
        return this.breaker.exec(() => Promise.resolve(this.handler(job)));
      }
      return this.handler(job);
    };
    if (this.bulkhead) {
      return this.bulkhead.exec(run);
    }
    return run();
  }

  private async handleFailure(job: JobEnvelope, error: unknown): Promise<JobEnvelope> {
    const message = error instanceof Error ? error.message : String(error);
    const retryable = isRetryable(error);
    const attemptsLeft = job.attempt < job.maxAttempts;

    if (retryable && attemptsLeft) {
      const delayMs = computeBackoff(job.attempt, this.retry);
      const retried = await this.transport.retry(job, delayMs, message);
      this.onEvent?.({ type: "retrying", job: retried, delayMs });
      return retried;
    }

    if (!retryable) {
      const failed = await this.transport.fail(job, message);
      this.onEvent?.({ type: "failed", job: failed });
      return failed;
    }

    const dead = await this.transport.deadLetter(job, message);
    this.onEvent?.({ type: "dead_lettered", job: dead });
    return dead;
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      const job = await this.processNext(this.pollIntervalMs);
      if (!job && this.running) {
        await this.clock.sleep(this.pollIntervalMs);
      }
    }
  }
}
