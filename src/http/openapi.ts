/**
 * OpenAPI 3.1 document served at GET /openapi.json.
 * Keep `openapi/openapi.yaml` in sync with this object.
 */
export const OPENAPI_DOCUMENT = {
  openapi: "3.1.0",
  info: {
    title: "RelayKit",
    version: "0.1.0",
    description:
      "Local-first job relay HTTP API. Optional API key via X-API-Key or Authorization: Bearer (RELAYKIT_API_KEY). No paid IdP.",
  },
  servers: [{ url: "http://127.0.0.1:3000", description: "Local default" }],
  tags: [
    { name: "jobs", description: "Enqueue and inspect jobs" },
    { name: "ops", description: "Health, OpenAPI, and metrics" },
  ],
  components: {
    securitySchemes: {
      apiKey: {
        type: "apiKey",
        in: "header",
        name: "X-API-Key",
        description: "Local demo key from RELAYKIT_API_KEY. Omit the env var to disable auth.",
      },
      bearer: {
        type: "http",
        scheme: "bearer",
        description: "Same value as X-API-Key, sent as Authorization: Bearer <key>.",
      },
    },
    schemas: {
      JobEnvelope: {
        type: "object",
        required: [
          "id",
          "type",
          "payload",
          "idempotencyKey",
          "status",
          "attempt",
          "maxAttempts",
          "createdAt",
          "updatedAt",
          "availableAt",
        ],
        properties: {
          id: { type: "string", format: "uuid" },
          type: { type: "string" },
          payload: {},
          idempotencyKey: { type: "string" },
          status: {
            type: "string",
            enum: [
              "pending",
              "queued",
              "processing",
              "retrying",
              "succeeded",
              "failed",
              "dead_lettered",
            ],
          },
          attempt: { type: "integer", minimum: 0 },
          maxAttempts: { type: "integer", minimum: 1 },
          createdAt: { type: "integer" },
          updatedAt: { type: "integer" },
          availableAt: { type: "integer" },
          lastError: { type: "string" },
          result: {},
        },
      },
      EnqueueRequest: {
        type: "object",
        required: ["type", "idempotencyKey"],
        properties: {
          type: { type: "string" },
          payload: {},
          idempotencyKey: { type: "string", minLength: 1 },
          maxAttempts: { type: "integer", minimum: 1, maximum: 20 },
        },
      },
      EnqueueResponse: {
        type: "object",
        required: ["job", "duplicate"],
        properties: {
          job: { $ref: "#/components/schemas/JobEnvelope" },
          duplicate: { type: "boolean" },
        },
      },
      ErrorBody: {
        type: "object",
        properties: {
          error: { type: "string" },
          hint: { type: "string" },
        },
      },
    },
  },
  paths: {
    "/health": {
      get: {
        tags: ["ops"],
        summary: "Liveness",
        security: [],
        responses: {
          "200": {
            description: "ok",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean" },
                    service: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/openapi.json": {
      get: {
        tags: ["ops"],
        summary: "OpenAPI document",
        security: [],
        responses: { "200": { description: "OpenAPI 3.1 JSON" } },
      },
    },
    "/metrics": {
      get: {
        tags: ["ops"],
        summary: "Prometheus text exposition (processed, failed, DLQ, retries, duplicates, lag)",
        security: [],
        responses: { "200": { description: "text/plain; version=0.0.4" } },
      },
    },
    "/v1/jobs": {
      post: {
        tags: ["jobs"],
        summary: "Enqueue a job",
        description:
          "Idempotent enqueue. Re-using idempotencyKey returns the original envelope with duplicate=true.",
        security: [{ apiKey: [] }, { bearer: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/EnqueueRequest" } },
          },
        },
        responses: {
          "202": {
            description: "accepted",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/EnqueueResponse" } },
            },
          },
          "200": {
            description: "duplicate suppressed",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/EnqueueResponse" } },
            },
          },
          "400": {
            description: "invalid body",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ErrorBody" } },
            },
          },
          "401": { description: "API key required or invalid" },
          "503": { description: "relay not configured" },
        },
      },
    },
    "/v1/jobs/{id}": {
      get: {
        tags: ["jobs"],
        summary: "Job status",
        security: [{ apiKey: [] }, { bearer: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "job envelope",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/JobEnvelope" } },
            },
          },
          "401": { description: "API key required or invalid" },
          "404": { description: "unknown job" },
          "503": { description: "relay not configured" },
        },
      },
    },
    "/v1/dlq": {
      get: {
        tags: ["jobs"],
        summary: "Inspect dead-letter queue",
        security: [{ apiKey: [] }, { bearer: [] }],
        responses: {
          "200": {
            description: "dead-lettered jobs",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["count", "jobs"],
                  properties: {
                    count: { type: "integer" },
                    jobs: {
                      type: "array",
                      items: { $ref: "#/components/schemas/JobEnvelope" },
                    },
                  },
                },
              },
            },
          },
          "401": { description: "API key required or invalid" },
          "503": { description: "relay not configured" },
        },
      },
    },
  },
} as const;
