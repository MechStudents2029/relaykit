export function normalizeIdempotencyKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) {
    throw new Error("idempotency key must be a non-empty string");
  }
  return trimmed;
}

export class InMemoryIdempotencyStore {
  private readonly keys = new Map<string, string>();

  /** Returns the existing job id when the key was already reserved. */
  reserve(key: string, jobId: string): string | undefined {
    const normalized = normalizeIdempotencyKey(key);
    const existing = this.keys.get(normalized);
    if (existing) {
      return existing;
    }
    this.keys.set(normalized, jobId);
    return undefined;
  }

  get(key: string): string | undefined {
    return this.keys.get(normalizeIdempotencyKey(key));
  }

  size(): number {
    return this.keys.size;
  }
}
