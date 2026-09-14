import type { Clock } from "./clock.js";
import { Worker, type JobHandler, type WorkerEvent, type WorkerOptions } from "./worker.js";
import type { CircuitBreaker } from "../resilience/circuit-breaker.js";
import type { Bulkhead } from "../resilience/bulkhead.js";
import { DeadLetterQueue } from "../resilience/dlq.js";
import type { RetryPolicy } from "../resilience/retry.js";
import type { EnqueueInput, EnqueueResult, JobEnvelope } from "../types/job.js";
import type { Transport } from "../transport/types.js";

export interface RelayOptions {
  transport: Transport;
  handler: JobHandler;
  clock?: Clock;
  retry?: RetryPolicy;
  breaker?: CircuitBreaker;
  bulkhead?: Bulkhead;
  pollIntervalMs?: number;
  onEvent?: (event: WorkerEvent) => void;
}

export class Relay {
  readonly worker: Worker;
  readonly dlq: DeadLetterQueue;
  private readonly transport: Transport;

  constructor(options: RelayOptions) {
    this.transport = options.transport;
    this.dlq = new DeadLetterQueue(options.transport);
    const workerOptions: WorkerOptions = {
      transport: options.transport,
      handler: options.handler,
      clock: options.clock,
      retry: options.retry,
      breaker: options.breaker,
      bulkhead: options.bulkhead,
      pollIntervalMs: options.pollIntervalMs,
      onEvent: options.onEvent,
    };
    this.worker = new Worker(workerOptions);
  }

  enqueue<T>(input: EnqueueInput<T>): Promise<EnqueueResult<T>> {
    return this.transport.enqueue(input);
  }

  getJob(id: string): Promise<JobEnvelope | undefined> {
    return this.transport.getById(id);
  }

  getByIdempotencyKey(key: string): Promise<JobEnvelope | undefined> {
    return this.transport.getByIdempotencyKey(key);
  }

  start(): void {
    this.worker.start();
  }

  stop(): Promise<void> {
    return this.worker.stop();
  }

  drain(maxJobs = 100): Promise<number> {
    return this.worker.drain(maxJobs);
  }

  close(): Promise<void> {
    return this.transport.close?.() ?? Promise.resolve();
  }
}
