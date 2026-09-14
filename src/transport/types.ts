import type { EnqueueInput, EnqueueResult, JobEnvelope } from "../types/job.js";

export interface Transport {
  enqueue<T>(input: EnqueueInput<T>): Promise<EnqueueResult<T>>;
  claim(blockMs?: number): Promise<JobEnvelope | undefined>;
  complete(job: JobEnvelope, result?: unknown): Promise<JobEnvelope>;
  retry(job: JobEnvelope, delayMs: number, error: string): Promise<JobEnvelope>;
  fail(job: JobEnvelope, error: string): Promise<JobEnvelope>;
  deadLetter(job: JobEnvelope, error: string): Promise<JobEnvelope>;
  getById(id: string): Promise<JobEnvelope | undefined>;
  getByIdempotencyKey(key: string): Promise<JobEnvelope | undefined>;
  listDeadLetters(): Promise<JobEnvelope[]>;
  pendingLag?(): Promise<number>;
  close?(): Promise<void>;
}
