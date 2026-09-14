# RelayKit — weekday build plan

Goal: five meaningful public commits (or small PRs) that read well on a resume and GitHub graph.

## Day 1 — Core types + in-memory relay
- Job envelope, idempotency key, status machine
- In-memory queue + worker loop
- Unit tests for happy path + duplicate suppression

## Day 2 — Redis Streams transport
- Producer / consumer group
- Docker Compose Redis
- Integration test against Redis

## Day 3 — Resilience
- Retry policies (exp backoff + jitter)
- DLQ for permanent failures
- Circuit breaker around flaky handlers

## Day 4 — HTTP API + OpenAPI
- Enqueue / status / DLQ inspect endpoints
- OpenAPI spec + generated types if clean
- Basic auth or API key stub for demos

## Day 5 — Metrics, load test, polish
- Metrics endpoint (processed, failed, lag)
- k6 or autocannon script
- README architecture diagram + resume bullet suggestions

Each day: focused commit messages like `feat(relay): add idempotent in-memory worker`.
