# RelayKit

Production-style **TypeScript job relay** and resilience toolkit — a resume-grade systems project with Redis Streams, retries, a DLQ, a circuit breaker, an OpenAPI HTTP API, and Prometheus-style metrics.

**No paid APIs, no required vendor keys, no cloud Redis.** See `AGENTS.md`.

## Quick start

```bash
npm install
npm test
npm run build
npm run dev              # in-memory walkthrough
npm run serve            # HTTP API on http://127.0.0.1:3000
```

### Local Redis

```bash
npm run docker:up        # docker compose up -d
npm run test:integration # skips cleanly if Redis is down
RELAYKIT_TRANSPORT=redis npm run serve
```

`REDIS_URL` defaults to `redis://127.0.0.1:6379`.

Optional local API key (not a paid IdP):

```bash
RELAYKIT_API_KEY=dev-local npm run serve
curl -H 'X-API-Key: dev-local' -H 'content-type: application/json' \
  -d '{"type":"echo","payload":{"n":1},"idempotencyKey":"job-1"}' \
  http://127.0.0.1:3000/v1/jobs
```

`USE_PUBLIC_API=1` makes the demo handler call JSONPlaceholder (free, no key).

## HTTP API

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | public | Liveness |
| GET | `/openapi.json` | public | OpenAPI 3.1 |
| GET | `/metrics` | public | Prometheus text |
| POST | `/v1/jobs` | API key if configured | Enqueue (idempotent) |
| GET | `/v1/jobs/:id` | API key if configured | Job status |
| GET | `/v1/dlq` | API key if configured | Inspect dead letters |

Send `X-API-Key` or `Authorization: Bearer <key>` when `RELAYKIT_API_KEY` is set. If the env var is unset, `/v1` is open for local demos.

```bash
# enqueue
curl -s -X POST http://127.0.0.1:3000/v1/jobs \
  -H 'content-type: application/json' \
  -d '{"type":"echo","payload":{"n":1},"idempotencyKey":"job-1"}'

# status
curl -s http://127.0.0.1:3000/v1/jobs/<id>

# DLQ
curl -s http://127.0.0.1:3000/v1/dlq

# metrics
curl -s http://127.0.0.1:3000/metrics
```

Spec: `openapi/openapi.yaml` (same document as `GET /openapi.json`).

## Architecture

```
  HTTP POST /v1/jobs  (optional X-API-Key)
           |
           v
  idempotency key ── duplicate? ── return existing envelope
           |
           |  new
           v
  Transport: MemoryTransport  or  Redis Streams
             (XADD / XREADGROUP / XACK
              + delayed ZSET + DLQ stream)
           |
           |  claim()
           v
  Worker ── circuit breaker ── bulkhead ── handler
           |                      |
           |                      +-- optional JSONPlaceholder / httpbin
           v
     succeeded | retry+jitter | failed | dead_lettered
           |
           v
  GET /v1/jobs/:id   GET /v1/dlq   GET /metrics
```

**Status machine:** `pending → queued → processing → succeeded | retrying | failed | dead_lettered`, with `retrying → queued`.

**Idempotency:** the first enqueue for a key wins. Re-enqueues return the existing envelope (`HTTP 200` + `duplicate: true`) and the handler runs once.

**Redis path:** delayed retries sit in a sorted set until `availableAt`, then are promoted back onto the stream. Exhausted jobs go to a DLQ stream.

**Metrics:** worker events increment in-process counters; `relaykit_consumer_lag` is memory queued-job count or Redis `XINFO GROUPS` lag + delayed ZSET.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | In-memory demo (duplicate suppression + retry) |
| `npm run serve` | HTTP API + worker (`--http` also works on `dev`) |
| `npm test` | Unit tests (no Redis required) |
| `npm run test:integration` | Redis Streams tests; skip if Redis is down |
| `npm run build` | `tsc` → `dist/` |
| `npm run docker:up` | Start local Redis 7 |
| `npm run loadtest` | Local autocannon against an ephemeral server |

## Repository layout

```
src/types          Job envelope + status
src/core           Status machine, worker, relay
src/transport      In-memory queue
src/redis          Streams producer / consumer group
src/resilience     Backoff, circuit breaker, bulkhead, DLQ
src/handlers       Free public-API demo handler
src/http           HTTP API, auth stub, OpenAPI document
src/metrics        Prometheus-style registry
src/server.ts      `npm run serve`
openapi/           OpenAPI YAML (kept in sync with /openapi.json)
scripts/           Local autocannon load test
```

Weekday slices: `WEEK_PLAN.md`.

## Suggested resume bullets

- Built a TypeScript job relay with a typed status machine, idempotent enqueue, and an in-memory worker covered by Vitest happy-path and duplicate-suppression tests.
- Implemented a Redis Streams producer/consumer-group transport with delayed retries (sorted set) and a dead-letter stream, plus integration tests that skip when local Redis is down.
- Added exponential backoff with jitter, a circuit breaker around flaky handlers, and a no-key public HTTP demo handler with failure injection.
- Exposed an OpenAPI 3.1 HTTP API (enqueue, status, DLQ inspect) with a local API-key stub, Prometheus-style metrics, and an autocannon load-test harness — no paid SaaS.

## License

MIT
