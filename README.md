# RelayKit

Production-style **TypeScript job relay** and resilience toolkit — a resume-grade systems project you can extend one weekday slice at a time.

Days 1–3 are implemented: in-memory relay, Redis Streams transport, retries, DLQ, and a circuit breaker. Days 4–5 are stubbed so HTTP/OpenAPI and metrics/load-test work stays obvious.

## What it demonstrates

- Redis Streams consumer groups (local Docker Redis only)
- Idempotent job processing
- Retry with exponential backoff + jitter
- Dead-letter queue (DLQ)
- Circuit breaker + bulkhead hooks
- OpenAPI-documented HTTP API (Day 4 scaffold)
- Prometheus-style metrics endpoint (Day 5 stub)
- Load-test harness stub + unit/integration tests
- Docker Compose for local Redis

**No paid APIs, no required keys, no cloud Redis.** See `AGENTS.md`.

## Quick start

```bash
npm install
npm test
npm run build
npm run dev
```

### Local Redis (Day 2 path)

```bash
npm run docker:up          # docker compose up -d
npm run test:integration   # skips cleanly if Redis is down
```

`REDIS_URL` defaults to `redis://127.0.0.1:6379`. Integration tests create an isolated key prefix per case and skip when the probe cannot connect — they do not fail the suite offline.

Optional: `USE_PUBLIC_API=1 npm run dev` calls JSONPlaceholder (free, no key) through the allowlisted demo handler.

## Architecture

```
                 enqueue(idempotencyKey)
Producer  ---------------------------------+
                                           |
                                           v
                              +------------------------+
                              | Transport              |
                              |  MemoryTransport  or   |
                              |  Redis Streams         |
                              |  + delayed ZSET + DLQ  |
                              +-----------+------------+
                                          |
                                          | claim()
                                          v
                              +------------------------+
                              | Worker                 |
                              |  circuit breaker       |
                              |  bulkhead (optional)   |
                              |  retry + jitter        |
                              +-----------+------------+
                                          |
                    +---------------------+----------------------+
                    |                     |                      |
                    v                     v                      v
               succeeded              retry later          dead letter
```

**Status machine:** `pending → queued → processing → succeeded | retrying | failed | dead_lettered`, with `retrying → queued`.

**Idempotency:** the first `enqueue` for a key wins. Re-enqueues return the existing envelope and the handler runs once.

**Redis path:** `XADD` / `XREADGROUP` / `XACK`. Delayed retries sit in a sorted set until `availableAt`, then are promoted back onto the stream. Permanent exhaustion is written to a DLQ stream.

**Demo handler:** `src/handlers/public-api.ts` may call JSONPlaceholder, httpbin, or Open-Meteo. Tests inject failures and never need a network or a key.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | In-memory demo (duplicate suppression + retry) |
| `npm test` | Unit tests (no Redis required) |
| `npm run test:integration` | Redis Streams tests; skip if Redis is down |
| `npm run build` | `tsc` → `dist/` |
| `npm run docker:up` | Start local Redis 7 |
| `npm run loadtest` | Day 5 stub (prints the planned autocannon/k6 steps) |

## Repository layout

```
src/types          Job envelope + status
src/core           Status machine, worker, relay
src/transport      In-memory queue
src/redis          Streams producer / consumer group
src/resilience     Backoff, circuit breaker, bulkhead, DLQ
src/handlers       Free public-API demo handler
src/http           Day 4 route scaffold
src/metrics        Day 5 /metrics stub
openapi/           OpenAPI YAML stub
```

Weekday slices: `WEEK_PLAN.md`.

## Suggested resume bullets

- Built a TypeScript job relay with a typed status machine, idempotent enqueue, and an in-memory worker covered by Vitest happy-path and duplicate-suppression tests.
- Implemented a Redis Streams producer/consumer-group transport with delayed retries (sorted set) and a dead-letter stream, plus integration tests that skip when local Redis is down.
- Added exponential backoff with jitter, a circuit breaker around flaky handlers, and a no-key public HTTP demo handler with failure injection.

## License

MIT
