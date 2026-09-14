/**
 * Day 5 stub — in-process counters so /metrics has a shape.
 * Replace with labeled Prometheus counters + Redis stream lag.
 */
export interface MetricsRegistry {
  processed: number;
  failed: number;
  deadLettered: number;
  retried: number;
  duplicates: number;
}

export function createMetricsRegistry(): MetricsRegistry {
  return {
    processed: 0,
    failed: 0,
    deadLettered: 0,
    retried: 0,
    duplicates: 0,
  };
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
    "# HELP relaykit_consumer_lag Pending Redis Stream entries (Day 5 TODO).",
    "# TYPE relaykit_consumer_lag gauge",
    "relaykit_consumer_lag 0",
    "",
  ].join("\n");
}
