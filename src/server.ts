import { pathToFileURL } from "node:url";
import { Relay } from "./core/relay.js";
import { TransientError } from "./core/errors.js";
import type { JobHandler } from "./core/worker.js";
import { createPublicApiHandler } from "./handlers/public-api.js";
import { listenHttp } from "./http/server.js";
import { createMetricsRegistry } from "./metrics/registry.js";
import { RedisStreamsTransport, redisAvailable } from "./redis/streams.js";
import { CircuitBreaker } from "./resilience/circuit-breaker.js";
import { MemoryTransport } from "./transport/memory.js";
import type { Transport } from "./transport/types.js";

export interface ServeOptions {
  host?: string;
  port?: number;
  apiKey?: string;
  transport?: "memory" | "redis";
  usePublicApi?: boolean;
}

export async function startServer(options: ServeOptions = {}): Promise<{
  close: () => Promise<void>;
  port: number;
  host: string;
}> {
  const host = options.host ?? process.env.HOST ?? "127.0.0.1";
  const port = options.port ?? Number(process.env.PORT ?? 3000);
  const apiKey = options.apiKey ?? process.env.RELAYKIT_API_KEY;
  const wantRedis =
    options.transport === "redis" ||
    process.env.RELAYKIT_TRANSPORT === "redis" ||
    Boolean(process.env.REDIS_URL);
  const usePublicApi = options.usePublicApi ?? process.env.USE_PUBLIC_API === "1";

  const transport = await createTransport(wantRedis);
  const metrics = createMetricsRegistry();
  const handler: JobHandler = usePublicApi
    ? createPublicApiHandler()
    : async (job) => {
        const payload = job.payload as { failUntilAttempt?: number };
        if (job.attempt < (payload.failUntilAttempt ?? 0)) {
          throw new TransientError(`simulated flake on attempt ${job.attempt}`);
        }
        return { echoed: job.payload, attempt: job.attempt };
      };

  const relay = new Relay({
    transport,
    handler,
    metrics,
    breaker: new CircuitBreaker({ failureThreshold: 20, resetTimeoutMs: 1_000 }),
    onEvent: (event) => {
      const id = "job" in event ? event.job.id.slice(0, 8) : "";
      console.log(`  event=${event.type}${id ? ` job=${id}` : ""}`);
    },
  });
  relay.start();

  const server = await listenHttp({
    relay,
    metrics,
    apiKey: apiKey && apiKey.length > 0 ? apiKey : undefined,
    host,
    port,
  });
  const address = server.address();
  const boundPort = typeof address === "object" && address ? address.port : port;

  console.log(`RelayKit HTTP listening on http://${host}:${boundPort}`);
  console.log(`  OpenAPI  GET /openapi.json`);
  console.log(`  Enqueue  POST /v1/jobs`);
  console.log(`  Status   GET /v1/jobs/:id`);
  console.log(`  DLQ      GET /v1/dlq`);
  console.log(`  Metrics  GET /metrics`);
  if (apiKey) {
    console.log("  Auth     X-API-Key / Bearer (RELAYKIT_API_KEY is set)");
  } else {
    console.log("  Auth     disabled (set RELAYKIT_API_KEY to require a local key)");
  }

  const close = async (): Promise<void> => {
    await relay.stop();
    await relay.close();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  };

  return { close, port: boundPort, host };
}

async function createTransport(wantRedis: boolean): Promise<Transport> {
  if (!wantRedis) {
    console.log("Transport: in-memory");
    return new MemoryTransport();
  }
  const ok = await redisAvailable();
  if (!ok) {
    console.warn("Redis unreachable — falling back to in-memory. Run `npm run docker:up`.");
    return new MemoryTransport();
  }
  console.log("Transport: Redis Streams");
  return new RedisStreamsTransport();
}

const invokedDirectly =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (invokedDirectly) {
  const started = await startServer();
  const shutdown = (): void => {
    void started.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
