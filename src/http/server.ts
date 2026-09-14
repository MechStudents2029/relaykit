import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Relay } from "../core/relay.js";
import { renderMetrics, type MetricsRegistry } from "../metrics/registry.js";
import { apiKeyAuthorized, isPublicPath } from "./auth.js";
import { OPENAPI_DOCUMENT } from "./openapi.js";

const MAX_JSON_BYTES = 1_000_000;

export interface HttpServerOptions {
  relay?: Relay;
  metrics?: MetricsRegistry;
  apiKey?: string;
  host?: string;
  port?: number;
}

export function createHttpServer(options: HttpServerOptions = {}): Server {
  return createServer((req, res) => {
    void handle(req, res, options).catch((error: unknown) => {
      if (error instanceof SyntaxError) {
        json(res, 400, { error: "invalid JSON body" });
        return;
      }
      const message = error instanceof Error ? error.message : "internal error";
      json(res, 500, { error: message });
    });
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

  if (!isPublicPath(path) && !apiKeyAuthorized(req, options.apiKey)) {
    res.setHeader("www-authenticate", 'ApiKey realm="relaykit"');
    json(res, 401, {
      error: "unauthorized",
      hint: "Send X-API-Key or Authorization: Bearer matching RELAYKIT_API_KEY",
    });
    return;
  }

  if (req.method === "GET" && path === "/health") {
    json(res, 200, { ok: true, service: "relaykit" });
    return;
  }

  if (req.method === "GET" && (path === "/openapi.json" || path === "/docs")) {
    json(res, 200, OPENAPI_DOCUMENT);
    return;
  }

  if (req.method === "GET" && path === "/metrics") {
    const metrics = options.metrics ?? options.relay?.metrics;
    if (metrics && options.relay) {
      metrics.setConsumerLag(await options.relay.pendingLag());
    }
    text(res, 200, renderMetrics(metrics), "text/plain; version=0.0.4; charset=utf-8");
    return;
  }

  if (req.method === "POST" && path === "/v1/jobs") {
    await enqueue(req, res, options);
    return;
  }

  const jobMatch = /^\/v1\/jobs\/([^/]+)$/.exec(path);
  if (req.method === "GET" && jobMatch) {
    await jobStatus(res, options, decodeURIComponent(jobMatch[1] ?? ""));
    return;
  }

  if (req.method === "GET" && path === "/v1/dlq") {
    await inspectDlq(res, options);
    return;
  }

  json(res, 404, { error: "not found", hint: "See GET /openapi.json" });
}

async function enqueue(
  req: IncomingMessage,
  res: ServerResponse,
  options: HttpServerOptions,
): Promise<void> {
  const relay = options.relay;
  if (!relay) {
    json(res, 503, { error: "relay not configured" });
    return;
  }
  const body = await readJson(req);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    json(res, 400, { error: "JSON object body required" });
    return;
  }
  const { type, payload, idempotencyKey, maxAttempts } = body as Record<string, unknown>;
  if (typeof type !== "string" || type.trim().length === 0) {
    json(res, 400, { error: "type is required" });
    return;
  }
  if (typeof idempotencyKey !== "string" || idempotencyKey.trim().length === 0) {
    json(res, 400, { error: "idempotencyKey is required" });
    return;
  }
  if (maxAttempts !== undefined && (!Number.isInteger(maxAttempts) || (maxAttempts as number) < 1)) {
    json(res, 400, { error: "maxAttempts must be a positive integer" });
    return;
  }
  const result = await relay.enqueue({
    type: type.trim(),
    payload,
    idempotencyKey,
    maxAttempts: typeof maxAttempts === "number" ? maxAttempts : undefined,
  });
  json(res, result.duplicate ? 200 : 202, result);
}

async function jobStatus(
  res: ServerResponse,
  options: HttpServerOptions,
  id: string,
): Promise<void> {
  if (!options.relay) {
    json(res, 503, { error: "relay not configured" });
    return;
  }
  if (!id) {
    json(res, 404, { error: "not found" });
    return;
  }
  const job = await options.relay.getJob(id);
  if (!job) {
    json(res, 404, { error: "unknown job", id });
    return;
  }
  json(res, 200, job);
}

async function inspectDlq(res: ServerResponse, options: HttpServerOptions): Promise<void> {
  if (!options.relay) {
    json(res, 503, { error: "relay not configured" });
    return;
  }
  const jobs = await options.relay.dlq.list();
  json(res, 200, { count: jobs.length, jobs });
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
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > MAX_JSON_BYTES) {
      throw new SyntaxError("request body too large");
    }
    chunks.push(buf);
  }
  if (chunks.length === 0) {
    return undefined;
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}
