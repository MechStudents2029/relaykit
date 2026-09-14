export class RelayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidTransitionError extends RelayError {
  constructor(
    readonly from: string,
    readonly to: string,
  ) {
    super(`invalid job status transition: ${from} -> ${to}`);
  }
}

export class TransientError extends RelayError {
  readonly retryable = true as const;

  constructor(message: string) {
    super(message);
  }
}

export class PermanentError extends RelayError {
  readonly retryable = false as const;

  constructor(message: string) {
    super(message);
  }
}

export class CircuitOpenError extends RelayError {
  readonly retryable = true as const;

  constructor(readonly reopenAt: number) {
    super(`circuit breaker is open until ${reopenAt}`);
  }
}

export function isRetryable(error: unknown): boolean {
  if (error && typeof error === "object" && "retryable" in error) {
    return Boolean((error as { retryable: unknown }).retryable);
  }
  return true;
}
