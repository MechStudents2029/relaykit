export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Deterministic clock for unit tests — `sleep` advances time immediately. */
export class ManualClock implements Clock {
  constructor(private t = 0) {}

  now(): number {
    return this.t;
  }

  async sleep(ms: number): Promise<void> {
    this.advance(ms);
  }

  advance(ms: number): void {
    this.t += ms;
  }
}
