# RelayKit — weekday build plan

Goal: five meaningful public commits (or small PRs) that read well on a resume and GitHub graph.

## Day 1 — Core types + in-memory relay — done

- Job envelope, idempotency key, status machine
- In-memory queue + worker loop
- Unit tests for happy path + duplicate suppression

**Landed in:** `src/types/job.ts`, `src/core/status-machine.ts`, `src/core/idempotency.ts`, `src/transport/memory.ts`, `src/core/worker.ts`, `src/core/relay.ts`, `test/unit/status-machine.test.ts`, `test/unit/memory-worker.test.ts`

Suggested commit: `feat(relay): add idempotent in-memory worker`

## Day 2 — Redis Streams transport — done

- Producer / consumer group
- Docker Compose Redis
- Integration test against Redis (skips if Redis is down)

**Landed in:** `src/redis/streams.ts`, `src/redis/keys.ts`, `docker-compose.yml`, `test/integration/redis-streams.test.ts`

```bash
npm run docker:up
npm run test:integration
```

Suggested commit: `feat(redis): add streams producer and consumer group`

## Day 3 — Resilience — done

- Retry policies (exp backoff + jitter)
- DLQ for permanent exhaustion
- Circuit breaker around flaky handlers
- Demo handler for JSONPlaceholder/httpbin with failure injection

**Landed in:** `src/resilience/*`, `src/handlers/public-api.ts`, `test/unit/retry.test.ts`, `test/unit/circuit-breaker.test.ts`, `test/unit/resilience-worker.test.ts`, `test/unit/public-api-handler.test.ts`

Suggested commit: `feat(resilience): add backoff, DLQ, and circuit breaker`

## Day 4 — HTTP API + OpenAPI — stubbed (next weekday push)

- [ ] Finish enqueue / status / DLQ inspect endpoints (`src/http/server.ts` already has `/health`, `/openapi.json`, and a working enqueue stub when a `Relay` is passed)
- [ ] Expand `openapi/openapi.yaml` and keep it in sync with routes
- [ ] Optional local API-key header stub for demos (no paid IdP)
- [ ] `GET /v1/jobs/:id` and `GET /v1/dlq` currently return **501**

Suggested commit: `feat(http): enqueue, status, and DLQ inspect API`

## Day 5 — Metrics, load test, polish — stubbed (next weekday push)

- [ ] Live metrics: processed, failed, retried, duplicates, Redis stream lag (`src/metrics/registry.ts` is a static stub)
- [ ] Replace `scripts/load-test.mjs` with local autocannon or k6 (no paid load-test SaaS)
- [ ] Wire worker `onEvent` into the registry
- [ ] README architecture diagram is in place; refresh screenshots/numbers after the load test

Suggested commit: `feat(observability): metrics endpoint and local load test`

Each day: focused commit messages like `feat(relay): add idempotent in-memory worker`.
