/**
 * Limits concurrent handler executions (bulkhead isolation).
 * Day 3 hook — used by the worker when configured.
 */
export class Bulkhead {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly maxConcurrent: number) {
    if (maxConcurrent < 1) {
      throw new Error("bulkhead maxConcurrent must be >= 1");
    }
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      this.waiters.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.active -= 1;
    const next = this.waiters.shift();
    next?.();
  }
}
