#!/usr/bin/env node
/**
 * Day 5 stub — do not add paid load-test SaaS.
 * Planned local options: autocannon or k6 against POST /v1/jobs.
 */
const target = process.env.RELAYKIT_URL ?? "http://127.0.0.1:3000/v1/jobs";

console.log("RelayKit load-test stub (Day 5)");
console.log(`Target: ${target}`);
console.log("TODO: npm install -D autocannon  (or use a local k6 binary)");
console.log("TODO: burst enqueue with unique and duplicate idempotency keys");
console.log("TODO: assert processed + duplicate metrics on GET /metrics");
process.exit(0);
