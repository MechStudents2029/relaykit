import { randomUUID } from "node:crypto";
import type { Clock } from "../core/clock.js";
import { systemClock } from "../core/clock.js";
import { InMemoryIdempotencyStore, normalizeIdempotencyKey } from "../core/idempotency.js";
import { transition } from "../core/status-machine.js";
import { DEFAULT_MAX_ATTEMPTS, type EnqueueInput, type EnqueueResult, type JobEnvelope } from "../types/job.js";
import type { Transport } from "./types.js";

export interface MemoryTransportOptions {
  clock?: Clock;
  defaultMaxAttempts?: number;
}

export class MemoryTransport implements Transport {
  private readonly clock: Clock;
  private readonly defaultMaxAttempts: number;
  private readonly jobs = new Map<string, JobEnvelope>();
  private readonly queue: string[] = [];
  private readonly dlq: string[] = [];
  private readonly idempotency = new InMemoryIdempotencyStore();
  private readonly waiters: Array<() => void> = [];

  constructor(options: MemoryTransportOptions = {}) {
    this.clock = options.clock ?? systemClock;
    this.defaultMaxAttempts = options.defaultMaxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  }

  async enqueue<T>(input: EnqueueInput<T>): Promise<EnqueueResult<T>> {
    const key = normalizeIdempotencyKey(input.idempotencyKey);
    const id = input.id ?? randomUUID();
    const existingId = this.idempotency.reserve(key, id);
    if (existingId) {
      const existing = this.jobs.get(existingId);
      if (!existing) {
        throw new Error(`idempotency key ${key} points at missing job ${existingId}`);
      }
      return { job: existing as JobEnvelope<T>, duplicate: true };
    }

    const now = this.clock.now();

    const pending: JobEnvelope<T> = {
      id,
      type: input.type,
      payload: input.payload,
      idempotencyKey: key,
      status: "pending",
      attempt: 0,
      maxAttempts: input.maxAttempts ?? this.defaultMaxAttempts,
      createdAt: now,
      updatedAt: now,
      availableAt: now,
    };
    const queued = transition(pending, "queued", now);
    this.jobs.set(id, queued);
    this.queue.push(id);
    this.notify();
    return { job: queued, duplicate: false };
  }

  async claim(blockMs = 0): Promise<JobEnvelope | undefined> {
    const deadline = this.clock.now() + Math.max(0, blockMs);
    while (true) {
      const job = this.claimReady();
      if (job) {
        return job;
      }
      const remaining = deadline - this.clock.now();
      if (remaining <= 0) {
        return undefined;
      }
      await this.waitForWork(remaining);
    }
  }

  async complete(job: JobEnvelope, result?: unknown): Promise<JobEnvelope> {
    const current = this.require(job.id);
    const next = transition(current, "succeeded", this.clock.now(), { result, lastError: undefined });
    this.jobs.set(job.id, next);
    return next;
  }

  async retry(job: JobEnvelope, delayMs: number, error: string): Promise<JobEnvelope> {
    const current = this.require(job.id);
    const now = this.clock.now();
    const retrying = transition(current, "retrying", now, {
      lastError: error,
      availableAt: now + Math.max(0, delayMs),
    });
    const queued = transition(retrying, "queued", now, {
      lastError: error,
      availableAt: retrying.availableAt,
    });
    this.jobs.set(job.id, queued);
    this.queue.push(job.id);
    this.notify();
    return queued;
  }

  async fail(job: JobEnvelope, error: string): Promise<JobEnvelope> {
    const current = this.require(job.id);
    const next = transition(current, "failed", this.clock.now(), { lastError: error });
    this.jobs.set(job.id, next);
    return next;
  }

  async deadLetter(job: JobEnvelope, error: string): Promise<JobEnvelope> {
    const current = this.require(job.id);
    const next = transition(current, "dead_lettered", this.clock.now(), { lastError: error });
    this.jobs.set(job.id, next);
    this.dlq.push(job.id);
    return next;
  }

  async getById(id: string): Promise<JobEnvelope | undefined> {
    return this.jobs.get(id);
  }

  async getByIdempotencyKey(key: string): Promise<JobEnvelope | undefined> {
    const id = this.idempotency.get(key);
    return id ? this.jobs.get(id) : undefined;
  }

  async listDeadLetters(): Promise<JobEnvelope[]> {
    return this.dlq
      .map((id) => this.jobs.get(id))
      .filter((job): job is JobEnvelope => Boolean(job));
  }

  async pendingLag(): Promise<number> {
    let count = 0;
    for (const job of this.jobs.values()) {
      if (job.status === "queued") {
        count += 1;
      }
    }
    return count;
  }

  size(): number {
    return this.jobs.size;
  }

  private claimReady(): JobEnvelope | undefined {
    const now = this.clock.now();
    for (let i = 0; i < this.queue.length; i += 1) {
      const id = this.queue[i];
      if (!id) {
        continue;
      }
      const job = this.jobs.get(id);
      if (!job || job.status !== "queued") {
        this.queue.splice(i, 1);
        i -= 1;
        continue;
      }
      if (job.availableAt > now) {
        continue;
      }
      this.queue.splice(i, 1);
      const next = transition(job, "processing", now, { attempt: job.attempt + 1 });
      this.jobs.set(id, next);
      return next;
    }
    return undefined;
  }

  private require(id: string): JobEnvelope {
    const job = this.jobs.get(id);
    if (!job) {
      throw new Error(`unknown job ${id}`);
    }
    return job;
  }

  private notify(): void {
    const waiters = this.waiters.splice(0);
    for (const wake of waiters) {
      wake();
    }
  }

  private waitForWork(ms: number): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        resolve();
      };
      this.waiters.push(finish);
      void this.clock.sleep(ms).then(finish);
    });
  }
}
