import { describe, expect, it } from "vitest";
import { createMetricsRegistry, renderMetrics } from "../../src/metrics/registry.js";

describe("metrics registry", () => {
  it("counts worker events and renders prometheus text", () => {
    const metrics = createMetricsRegistry();
    metrics.apply({ type: "claimed", job: {} as never });
    metrics.apply({ type: "succeeded", job: {} as never });
    metrics.apply({ type: "retrying", job: {} as never, delayMs: 10 });
    metrics.apply({ type: "dead_lettered", job: {} as never });
    metrics.recordDuplicate();
    metrics.setConsumerLag(4);

    const text = renderMetrics(metrics);
    expect(text).toContain("relaykit_jobs_processed_total 1");
    expect(text).toContain("relaykit_jobs_retried_total 1");
    expect(text).toContain("relaykit_jobs_dead_lettered_total 1");
    expect(text).toContain("relaykit_jobs_duplicates_total 1");
    expect(text).toContain("relaykit_consumer_lag 4");
  });
});
