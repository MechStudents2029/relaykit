import type { JobEnvelope } from "../types/job.js";
import type { Transport } from "../transport/types.js";

/** Thin inspector over whatever transport stores permanently failed jobs. */
export class DeadLetterQueue {
  constructor(private readonly transport: Transport) {}

  list(): Promise<JobEnvelope[]> {
    return this.transport.listDeadLetters();
  }

  async size(): Promise<number> {
    return (await this.list()).length;
  }
}
