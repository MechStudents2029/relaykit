# Agent notes for RelayKit

## Hard constraints

- **Free and local only.** Do not add paid APIs, paid SaaS, purchases, or required API keys.
- Redis runs on the developer machine via `docker compose` (`npm run docker:up`). No cloud Redis (Upstash, ElastiCache, Redis Cloud, etc.).
- Demo HTTP jobs may call **no-key public APIs only** (JSONPlaceholder, httpbin, Open-Meteo). Allowlist lives in `src/handlers/public-api.ts`.
- Never add Stripe, OpenAI, paid search, analytics SDKs, or similar.

If a feature seems to need a vendor key, stop and implement a local stub instead.

## How to verify

```bash
npm install
npm test
npm run build
npm run docker:up   # local Redis
npm run test:integration
npm run dev
```

Integration tests skip (they do not fail) when Redis is unreachable.

## Layout

- Days 1–3 (implemented): `src/types`, `src/core`, `src/transport`, `src/redis`, `src/resilience`, `src/handlers`
- Days 4–5 (stubs): `src/http`, `src/metrics`, `openapi/openapi.yaml`, `scripts/load-test.mjs`
