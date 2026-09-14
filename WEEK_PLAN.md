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

## Day 4 — HTTP API + OpenAPI — done

- Enqueue / status / DLQ inspect endpoints
- OpenAPI spec (`openapi/openapi.yaml` and `GET /openapi.json`)
- Local API-key stub (`RELAYKIT_API_KEY`, `X-API-Key` or Bearer — no paid IdP)

**Landed in:** `src/http/server.ts`, `src/http/auth.ts`, `src/http/openapi.ts`, `src/server.ts`, `test/unit/http-api.test.ts`, `test/unit/auth.test.ts`

```bash
npm run serve
curl -s http://127.0.0.1:3000/openapi.json
```

Suggested commit: `feat(http): enqueue, status, and DLQ inspect API`

## Day 5 — Metrics, load test, polish — done

- Live metrics: processed, failed, retried, duplicates, claimed, consumer lag
- `scripts/load-test.ts` via local autocannon (no paid load-test SaaS)
- Worker `onEvent` wired into `MetricsRegistry`
- README architecture + resume bullets

**Landed in:** `src/metrics/registry.ts`, `scripts/load-test.ts`, `test/unit/metrics.test.ts`, `README.md`

```bash
npm run loadtest
```

Suggested commit: `feat(observability): metrics endpoint and local load test`

Each day: focused commit messages like `feat(relay): add idempotent in-memory worker`.
