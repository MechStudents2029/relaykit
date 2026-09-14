export const JOB_STATUSES = [
  "pending",
  "queued",
  "processing",
  "retrying",
  "succeeded",
  "failed",
  "dead_lettered",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export const TERMINAL_STATUSES: readonly JobStatus[] = [
  "succeeded",
  "failed",
  "dead_lettered",
];

export function isTerminalStatus(status: JobStatus): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

export interface JobEnvelope<T = unknown> {
  id: string;
  type: string;
  payload: T;
  idempotencyKey: string;
  status: JobStatus;
  attempt: number;
  maxAttempts: number;
  createdAt: number;
  updatedAt: number;
  availableAt: number;
  lastError?: string;
  result?: unknown;
}

export interface EnqueueInput<T = unknown> {
  type: string;
  payload: T;
  idempotencyKey: string;
  maxAttempts?: number;
  id?: string;
}

export interface EnqueueResult<T = unknown> {
  job: JobEnvelope<T>;
  duplicate: boolean;
}

export const DEFAULT_MAX_ATTEMPTS = 5;
