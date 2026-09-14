import { PermanentError, TransientError } from "../core/errors.js";
import type { JobHandler } from "../core/worker.js";

/** Free, no-key demo upstream. Never point this at a paid SaaS. */
export const JSONPLACEHOLDER_TODO = "https://jsonplaceholder.typicode.com/todos/1";
export const HTTPBIN_GET = "https://httpbin.org/get";

export interface PublicApiPayload {
  url?: string;
}

export interface PublicApiHandlerOptions {
  url?: string;
  fetchImpl?: typeof fetch;
  /** Fail this many times before calling upstream (unit-test injection). */
  injectFailures?: number;
  timeoutMs?: number;
}

export function createPublicApiHandler(options: PublicApiHandlerOptions = {}): JobHandler {
  let remainingFailures = options.injectFailures ?? 0;
  const fetchImpl = options.fetchImpl ?? fetch;
  const defaultUrl = options.url ?? JSONPLACEHOLDER_TODO;
  const timeoutMs = options.timeoutMs ?? 8_000;

  return async (job) => {
    if (remainingFailures > 0) {
      remainingFailures -= 1;
      throw new TransientError(`injected upstream failure (${remainingFailures} remaining)`);
    }

    const payload = (job.payload ?? {}) as PublicApiPayload;
    const url = payload.url ?? defaultUrl;
    if (!isAllowedPublicUrl(url)) {
      throw new PermanentError(`refusing non-allowlisted URL: ${url}`);
    }

    const signal = AbortSignal.timeout(timeoutMs);
    const response = await fetchImpl(url, { signal });
    if (!response.ok) {
      if (response.status >= 500 || response.status === 429) {
        throw new TransientError(`upstream ${response.status} from ${url}`);
      }
      throw new PermanentError(`upstream ${response.status} from ${url}`);
    }
    return response.json() as Promise<unknown>;
  };
}

const ALLOWED_HOSTS = new Set([
  "jsonplaceholder.typicode.com",
  "httpbin.org",
  "api.open-meteo.com",
]);

export function isAllowedPublicUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && ALLOWED_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}
