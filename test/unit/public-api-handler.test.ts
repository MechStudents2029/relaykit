import { describe, expect, it } from "vitest";
import { PermanentError, TransientError } from "../../src/core/errors.js";
import { createPublicApiHandler, isAllowedPublicUrl } from "../../src/handlers/public-api.js";
import type { JobEnvelope } from "../../src/types/job.js";

function envelope(payload: unknown): JobEnvelope {
  return {
    id: "j",
    type: "http",
    payload,
    idempotencyKey: "k",
    status: "processing",
    attempt: 1,
    maxAttempts: 3,
    createdAt: 0,
    updatedAt: 0,
    availableAt: 0,
  };
}

describe("public API demo handler", () => {
  it("injects transient failures before calling fetch", async () => {
    let fetches = 0;
    const handler = createPublicApiHandler({
      injectFailures: 2,
      fetchImpl: async () => {
        fetches += 1;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });

    await expect(handler(envelope({}))).rejects.toBeInstanceOf(TransientError);
    await expect(handler(envelope({}))).rejects.toBeInstanceOf(TransientError);
    await expect(handler(envelope({}))).resolves.toEqual({ ok: true });
    expect(fetches).toBe(1);
  });

  it("treats 5xx as retryable and 4xx as permanent", async () => {
    const fail500 = createPublicApiHandler({
      fetchImpl: async () => new Response("nope", { status: 503 }),
    });
    const fail400 = createPublicApiHandler({
      fetchImpl: async () => new Response("nope", { status: 404 }),
    });

    await expect(fail500(envelope({}))).rejects.toBeInstanceOf(TransientError);
    await expect(fail400(envelope({}))).rejects.toBeInstanceOf(PermanentError);
  });

  it("refuses non-allowlisted hosts", async () => {
    const handler = createPublicApiHandler({
      fetchImpl: async () => new Response("{}", { status: 200 }),
    });
    await expect(handler(envelope({ url: "https://example.com/secret" }))).rejects.toBeInstanceOf(
      PermanentError,
    );
    expect(isAllowedPublicUrl("https://jsonplaceholder.typicode.com/todos/1")).toBe(true);
    expect(isAllowedPublicUrl("http://jsonplaceholder.typicode.com/todos/1")).toBe(false);
  });
});
