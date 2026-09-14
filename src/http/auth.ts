import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

export const API_KEY_HEADER = "x-api-key";

export function extractApiKey(req: IncomingMessage): string | undefined {
  const header = headerValue(req, API_KEY_HEADER);
  if (header) {
    return header;
  }
  const authorization = headerValue(req, "authorization");
  if (!authorization) {
    return undefined;
  }
  const bearer = authorization.match(/^Bearer\s+(.+)$/i);
  if (bearer?.[1]) {
    return bearer[1].trim();
  }
  const apiKey = authorization.match(/^ApiKey\s+(.+)$/i);
  return apiKey?.[1]?.trim();
}

export function apiKeyAuthorized(req: IncomingMessage, expected?: string): boolean {
  if (!expected) {
    return true;
  }
  const provided = extractApiKey(req);
  if (!provided) {
    return false;
  }
  return secureEqual(provided, expected);
}

export function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/health" ||
    pathname === "/metrics" ||
    pathname === "/openapi.json" ||
    pathname === "/docs"
  );
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name];
  if (Array.isArray(raw)) {
    return raw[0];
  }
  return raw;
}

function secureEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
