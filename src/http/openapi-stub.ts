/**
 * Day 4 hook — replace with a generated OpenAPI document + typed routes.
 * Auth (API key / basic) is intentionally not implemented yet.
 */
export const OPENAPI_STUB = {
  openapi: "3.1.0",
  info: {
    title: "RelayKit",
    version: "0.1.0",
    description: "Job relay HTTP API (Day 4 scaffold).",
  },
  paths: {
    "/health": {
      get: { summary: "Liveness", responses: { "200": { description: "ok" } } },
    },
    "/v1/jobs": {
      post: {
        summary: "Enqueue a job (stub)",
        responses: {
          "202": { description: "accepted" },
          "501": { description: "not implemented until Day 4" },
        },
      },
    },
    "/v1/jobs/{id}": {
      get: { summary: "TODO Day 4 — job status", responses: { "501": { description: "todo" } } },
    },
    "/v1/dlq": {
      get: { summary: "TODO Day 4 — inspect DLQ", responses: { "501": { description: "todo" } } },
    },
    "/metrics": {
      get: { summary: "TODO Day 5 — Prometheus text", responses: { "200": { description: "stub" } } },
    },
  },
} as const;
