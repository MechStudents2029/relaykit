import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Relay } from "../core/relay.js";
import { renderMetrics, type MetricsRegistry } from "../metrics/registry.js";
import { OPENAPI_STUB } from "./openapi-stub.js";

/**
 * Day 4 scaffold — health + optional enqueue stub.
 * Remaining routes return 501 until the HTTP/OpenAPI slice lands.
 */
export interface HttpServerOptions {
  relay?: Relay;
  metrics?: MetricsRegistry;
  host?: string;
  port?: number;
}

export function createHttpServer(options: HttpServerOptions = {}): Server {
  return createServer((req, res) => {
    void handle(req, res, options);
  });
}

export async function listenHttp(options: HttpServerOptions = {}): Promise<Server> {
  const server = createHttpServer(options);
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 3000;
  await new Promise<void>((resolve) => {
    server.listen(port, host, resolve);
  });
  return server;
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  options: HttpServerOptions,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const path = url.pathname;

  if (req.method === "GET" && path === "/health") {
    return json(res, 200, { ok: true, service: "relaykit" });
  }

  if (req.method === "GET" && (path === "/openapi.json" || path === "/docs")) {
    return json(res, 200, OPENAPI_STUB);
  }

  if (req.method === "GET" && path === "/metrics") {
    // Day 5: swap this stub for live counters + consumer lag.
    return text(res, 200, renderMetrics(options.metrics), "text/plain; version=0.0.4");
  }

  if (req.method === "POST" && path === "/v1/jobs") {
    if (!options.relay) {
      return json(res, 501, {
        error: "enqueue stub — wire Relay on Day 4",
        todo: "Accept { type, payload, idempotencyKey } and return job envelope",
      });
    }
    const body = await readJson(req);
    if (!body || typeof body !== "object") {
      return json(res, 400, { error: "JSON body required" });
    }
    const { type, payload, idempotencyKey, maxAttempts } = body as Record<string, unknown>;
    if (typeof type !== "string" || typeof idempotencyKey !== "string") {
      return json(res, 400, { error: "type and idempotencyKey are required strings" });
    }
    const result = await options.relay.enqueue({
      type,
      payload,
      idempotencyKey,
      maxAttempts: typeof maxAttempts === "number" ? maxAttempts : undefined,
    });
    return json(res, result.duplicate ? 200 : 202, result);
  }

  if (req.method === "GET" && path.startsWith("/v1/jobs/")) {
    return json(res, 501, {
      error: "Day 4 TODO: GET /v1/jobs/:id",
      id: path.slice("/v1/jobs/".length),
    });
  }

  if (req.method === "GET" && path === "/v1/dlq") {
    return json(res, 501, { error: "Day 4 TODO: inspect dead-letter queue" });
  }

  json(res, 404, { error: "not found", hint: "See GET /openapi.json" });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function text(res: ServerResponse, status: number, body: string, contentType: string): void {
  res.writeHead(status, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return undefined;
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}
