import type { QuotaInfo, RateLimitInfo, ResponseMeta } from "../types/api.js";

/**
 * Parses the rate-limit and quota headers the Developer API sends, and exposes them without touching
 * the response body.
 *
 * The API sends a live snapshot on every `/v1/*` response, so callers can watch headroom without
 * spending a query unit on `GET /v1/usage`.
 */

/**
 * Slot the per-response metadata is stashed in.
 *
 * A `Symbol` key, defined non-enumerably, keeps {@link attachResponseMeta} invisible to
 * `JSON.stringify`, `Object.keys`, spreads, and deep-equality checks - so the object a caller receives
 * still serialises byte-for-byte as the API sent it. That is what lets `checkIp` return the API's own
 * payload directly while still making rate-limit headers reachable.
 */
const RESPONSE_META = Symbol.for("netriskscan.sdk.responseMeta");

function parseIntegerHeader(headers: Headers, name: string): number | undefined {
  const raw = headers.get(name);
  if (raw === null) return undefined;
  const value = Number(raw.trim());
  return Number.isFinite(value) ? value : undefined;
}

/** Reads `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`. */
export function parseRateLimit(headers: Headers): RateLimitInfo {
  return {
    limit: parseIntegerHeader(headers, "x-ratelimit-limit"),
    remaining: parseIntegerHeader(headers, "x-ratelimit-remaining"),
    reset: parseIntegerHeader(headers, "x-ratelimit-reset"),
  };
}

/** Reads `X-Quota-Limit`, `X-Quota-Used`, and `X-Quota-Remaining`. */
export function parseQuota(headers: Headers): QuotaInfo {
  return {
    limit: parseIntegerHeader(headers, "x-quota-limit"),
    used: parseIntegerHeader(headers, "x-quota-used"),
    remaining: parseIntegerHeader(headers, "x-quota-remaining"),
  };
}

/**
 * Reads `Retry-After` as a number of seconds.
 *
 * The Developer API always sends the delta-seconds form. The HTTP-date form is ignored rather than
 * guessed at, so a caller never backs off against a misparsed clock.
 */
export function parseRetryAfter(headers: Headers): number | undefined {
  const seconds = parseIntegerHeader(headers, "retry-after");
  return seconds !== undefined && seconds >= 0 ? seconds : undefined;
}

/** Builds the metadata snapshot for one response. */
export function buildResponseMeta(response: Response): ResponseMeta {
  return {
    requestId: response.headers.get("x-request-id") ?? undefined,
    rateLimit: parseRateLimit(response.headers),
    quota: parseQuota(response.headers),
    status: response.status,
  };
}

/** Attaches `meta` to `data` in a hidden slot, and returns `data` unchanged. */
export function attachResponseMeta<T extends object>(data: T, meta: ResponseMeta): T {
  Object.defineProperty(data, RESPONSE_META, {
    value: meta,
    enumerable: false,
    writable: false,
    configurable: true,
  });
  return data;
}

/**
 * Returns the rate-limit, quota, and request-ID metadata for a result the SDK returned.
 *
 * ```ts
 * const result = await client.checkIp("8.8.8.8");
 * const meta = getResponseMeta(result);
 * console.log(meta?.rateLimit.remaining, meta?.quota.remaining);
 * ```
 *
 * Returns `undefined` for anything the SDK did not produce - a value round-tripped through
 * `JSON.parse(JSON.stringify(...))`, for instance, since the slot is deliberately not serialised.
 */
export function getResponseMeta(value: unknown): ResponseMeta | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  return (value as Record<symbol, ResponseMeta | undefined>)[RESPONSE_META];
}
