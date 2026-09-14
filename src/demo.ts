import { Relay } from "./core/relay.js";
import { TransientError } from "./core/errors.js";
import type { JobHandler } from "./core/worker.js";
import { createPublicApiHandler } from "./handlers/public-api.js";
import { CircuitBreaker } from "./resilience/circuit-breaker.js";
import { MemoryTransport } from "./transport/memory.js";
import { startServer } from "./server.js";

/**
 * Local walkthrough: idempotent enqueue, injected failures, retry, then success.
 * `npm run dev` is in-memory. `npm run dev -- --http` (or `npm run serve`) starts the API.
 * Set USE_PUBLIC_API=1 to call JSONPlaceholder (free, no key) on the last hop.
 */
async function main(): Promise<void> {
  if (process.argv.includes("--http")) {
    const started = await startServer();
    const shutdown = (): void => {
      void started.close().then(() => process.exit(0));
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    return;
  }

  const usePublicApi = process.env.USE_PUBLIC_API === "1";
  const handler: JobHandler = usePublicApi
    ? createPublicApiHandler({ injectFailures: 1 })
    : async (job) => {
        const payload = job.payload as { failUntilAttempt?: number; n: number };
        if (job.attempt < (payload.failUntilAttempt ?? 0)) {
          throw new TransientError(`simulated flake on attempt ${job.attempt}`);
        }
        return { echoed: payload.n, attempt: job.attempt };
      };

  const transport = new MemoryTransport();
  const relay = new Relay({
    transport,
    handler,
    breaker: new CircuitBreaker({ failureThreshold: 8, resetTimeoutMs: 200 }),
    retry: { baseDelayMs: 0, maxDelayMs: 0, jitter: "none" },
    onEvent: (event) => {
      const id = "job" in event ? event.job.id.slice(0, 8) : "";
      console.log(`  event=${event.type}${id ? ` job=${id}` : ""}`);
    },
  });

  console.log("RelayKit demo (in-memory, local-only)\n");

  const first = await relay.enqueue({
    type: "echo",
    payload: { n: 1, failUntilAttempt: 2 },
    idempotencyKey: "demo-echo-1",
    maxAttempts: 3,
  });
  const dup = await relay.enqueue({
    type: "echo",
    payload: { n: 99, failUntilAttempt: 2 },
    idempotencyKey: "demo-echo-1",
    maxAttempts: 3,
  });

  console.log(`enqueued ${first.job.id} duplicate=${first.duplicate}`);
  console.log(`re-enqueue same key -> id=${dup.job.id} duplicate=${dup.duplicate}`);

  const processed = await relay.drain(10);
  const finalJob = await relay.getJob(first.job.id);
  console.log(`\ndrained ${processed} handler invocation(s)`);
  console.log(`final status=${finalJob?.status} attempt=${finalJob?.attempt}`);
  console.log(`result=${JSON.stringify(finalJob?.result)}`);
  console.log(`dlq size=${await relay.dlq.size()}`);
  console.log("\nNext: npm run serve     # HTTP API on :3000");
  console.log("      npm run docker:up && npm run test:integration");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
