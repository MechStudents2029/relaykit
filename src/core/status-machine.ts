import { InvalidTransitionError } from "./errors.js";
import type { JobEnvelope, JobStatus } from "../types/job.js";

const TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  pending: ["queued"],
  queued: ["processing"],
  processing: ["succeeded", "retrying", "failed", "dead_lettered"],
  retrying: ["queued"],
  succeeded: [],
  failed: [],
  dead_lettered: [],
};

export function allowedTransitions(from: JobStatus): readonly JobStatus[] {
  return TRANSITIONS[from];
}

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

export function transition<T>(
  job: JobEnvelope<T>,
  to: JobStatus,
  now: number,
  patch: Partial<Pick<JobEnvelope<T>, "lastError" | "result" | "availableAt" | "attempt">> = {},
): JobEnvelope<T> {
  assertTransition(job.status, to);
  return {
    ...job,
    ...patch,
    status: to,
    updatedAt: now,
  };
}
