export type JitterMode = "none" | "full" | "equal";

export interface RetryPolicy {
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: JitterMode;
  random?: () => number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  baseDelayMs: 100,
  maxDelayMs: 10_000,
  jitter: "full",
};

/**
 * Exponential backoff with optional jitter.
 * `attempt` is 1-based (first failure after attempt 1 uses 2^0).
 */
export function computeBackoff(attempt: number, policy: RetryPolicy): number {
  const exp = Math.min(
    policy.maxDelayMs,
    policy.baseDelayMs * 2 ** Math.max(0, attempt - 1),
  );
  const rand = policy.random ?? Math.random;
  if (policy.jitter === "none") {
    return Math.floor(exp);
  }
  if (policy.jitter === "equal") {
    return Math.floor(exp / 2 + rand() * (exp / 2));
  }
  return Math.floor(rand() * exp);
}

export function shouldRetry(attempt: number, maxAttempts: number, retryable: boolean): boolean {
  return retryable && attempt < maxAttempts;
}
