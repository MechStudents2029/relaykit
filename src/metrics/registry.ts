import type { WorkerEvent } from "../core/worker.js";

export class MetricsRegistry {
  processed = 0;
  failed = 0;
  deadLettered = 0;
  retried = 0;
  duplicates = 0;
  claimed = 0;
  circuitOpen = 0;
  consumerLag = 0;

  apply(event: WorkerEvent): void {
    switch (event.type) {
      case "claimed":
        this.claimed += 1;
        break;
      case "succeeded":
        this.processed += 1;
        break;
      case "failed":
        this.failed += 1;
        break;
      case "dead_lettered":
        this.deadLettered += 1;
        break;
      case "retrying":
        this.retried += 1;
        break;
      case "circuit_open":
        this.circuitOpen += 1;
        break;
    }
  }

  recordDuplicate(): void {
    this.duplicates += 1;
  }

  setConsumerLag(value: number): void {
    this.consumerLag = value;
  }
}

export function createMetricsRegistry(): MetricsRegistry {
  return new MetricsRegistry();
}

export function renderMetrics(registry?: MetricsRegistry): string {
  const m = registry ?? createMetricsRegistry();
  return [
    "# HELP relaykit_jobs_processed_total Jobs that reached a terminal success.",
    "# TYPE relaykit_jobs_processed_total counter",
    `relaykit_jobs_processed_total ${m.processed}`,
    "# HELP relaykit_jobs_failed_total Permanent (non-retryable) failures.",
    "# TYPE relaykit_jobs_failed_total counter",
    `relaykit_jobs_failed_total ${m.failed}`,
    "# HELP relaykit_jobs_dead_lettered_total Jobs moved to the DLQ.",
    "# TYPE relaykit_jobs_dead_lettered_total counter",
    `relaykit_jobs_dead_lettered_total ${m.deadLettered}`,
    "# HELP relaykit_jobs_retried_total Retry scheduling events.",
    "# TYPE relaykit_jobs_retried_total counter",
    `relaykit_jobs_retried_total ${m.retried}`,
    "# HELP relaykit_jobs_duplicates_total Enqueues suppressed by idempotency key.",
    "# TYPE relaykit_jobs_duplicates_total counter",
    `relaykit_jobs_duplicates_total ${m.duplicates}`,
    "# HELP relaykit_jobs_claimed_total Jobs claimed by a worker.",
    "# TYPE relaykit_jobs_claimed_total counter",
    `relaykit_jobs_claimed_total ${m.claimed}`,
    "# HELP relaykit_circuit_open_total Times the worker skipped claim because the breaker was open.",
    "# TYPE relaykit_circuit_open_total counter",
    `relaykit_circuit_open_total ${m.circuitOpen}`,
    "# HELP relaykit_consumer_lag Ready + delayed jobs waiting for a worker.",
    "# TYPE relaykit_consumer_lag gauge",
    `relaykit_consumer_lag ${m.consumerLag}`,
    "",
  ].join("\n");
}
