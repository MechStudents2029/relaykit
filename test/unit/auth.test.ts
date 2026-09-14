import { describe, expect, it } from "vitest";
import { apiKeyAuthorized, extractApiKey, isPublicPath } from "../../src/http/auth.js";
import type { IncomingMessage } from "node:http";

function req(headers: Record<string, string>): IncomingMessage {
  return { headers } as IncomingMessage;
}

describe("API key stub", () => {
  it("allows all requests when no expected key is configured", () => {
    expect(apiKeyAuthorized(req({}), undefined)).toBe(true);
    expect(apiKeyAuthorized(req({}), "")).toBe(true);
  });

  it("accepts X-API-Key and Bearer tokens", () => {
    expect(apiKeyAuthorized(req({ "x-api-key": "secret" }), "secret")).toBe(true);
    expect(apiKeyAuthorized(req({ authorization: "Bearer secret" }), "secret")).toBe(true);
    expect(apiKeyAuthorized(req({ authorization: "ApiKey secret" }), "secret")).toBe(true);
    expect(apiKeyAuthorized(req({ "x-api-key": "other" }), "secret")).toBe(false);
    expect(apiKeyAuthorized(req({}), "secret")).toBe(false);
  });

  it("extracts keys and treats ops routes as public", () => {
    expect(extractApiKey(req({ "x-api-key": "abc" }))).toBe("abc");
    expect(isPublicPath("/health")).toBe(true);
    expect(isPublicPath("/metrics")).toBe(true);
    expect(isPublicPath("/v1/jobs")).toBe(false);
  });
});
