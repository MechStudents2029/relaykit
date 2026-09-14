import { randomUUID } from "node:crypto";
import autocannon from "autocannon";
import { TransientError } from "../src/core/errors.js";
import { Relay } from "../src/core/relay.js";
import { listenHttp } from "../src/http/server.js";
import { createMetricsRegistry } from "../src/metrics/registry.js";
import { MemoryTransport } from "../src/transport/memory.js";

/**
 * Local load test — no paid SaaS.
 * Starts an ephemeral RelayKit HTTP server, hammers POST /v1/jobs, then prints /metrics.
 */
async function main(): Promise<void> {
  const metrics = createMetricsRegistry();
  const relay = new Relay({
    transport: new MemoryTransport(),
    metrics,
    retry: { baseDelayMs: 0, maxDelayMs: 0, jitter: "none" },
    handler: async (job) => {
      const payload = job.payload as { fail?: boolean };
      if (payload.fail) {
        throw new TransientError("load-test injected failure");
      }
      return { ok: true };
    },
  });
  const apiKey = "local-loadtest-key";
  const server = await listenHttp({ relay, metrics, apiKey, host: "127.0.0.1", port: 0 });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind");
  }
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const connections = Number(process.env.LOADTEST_CONNECTIONS ?? 10);
    const duration = Number(process.env.LOADTEST_DURATION ?? 2);
    const result = await autocannon({
      url: `${base}/v1/jobs`,
      method: "POST",
      connections,
      duration,
      pipelining: 1,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      setupClient(client) {
        client.setBody(
          JSON.stringify({
            type: "echo",
            payload: { n: 1 },
            idempotencyKey: `load-${randomUUID()}`,
          }),
        );
      },
    });

    const duplicateKey = "load-dup-shared";
    await fetch(`${base}/v1/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ type: "echo", payload: {}, idempotencyKey: duplicateKey }),
    });
    await fetch(`${base}/v1/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ type: "echo", payload: {}, idempotencyKey: duplicateKey }),
    });

    await relay.drain(10_000);

    const metricsText = await (await fetch(`${base}/metrics`)).text();
    console.log(autocannon.printResult(result));
    console.log("--- GET /metrics ---");
    console.log(metricsText);

    const twoX = result["2xx"] ?? 0;
    const non2xx = (result["1xx"] ?? 0) + (result["3xx"] ?? 0) + (result["4xx"] ?? 0) + (result["5xx"] ?? 0);
    if (twoX === 0 || non2xx > twoX * 0.1) {
      console.error(`load test saw too many non-2xx responses: 2xx=${twoX} other=${non2xx}`);
      process.exitCode = 1;
    } else {
      console.log(`load test ok: 2xx=${twoX} other=${non2xx} duplicates=${metrics.duplicates}`);
    }
  } finally {
    await relay.stop();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
