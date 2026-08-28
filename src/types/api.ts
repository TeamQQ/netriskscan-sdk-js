/** Client configuration, per-request options, and response metadata. */

/**
 * The shape of `fetch` the SDK needs.
 *
 * Deliberately structural rather than `typeof fetch`, so a custom implementation (a test double, an
 * instrumented fetch, a Workers/Deno/Bun binding) type-checks without having to match every overload of
 * whichever DOM or undici lib happens to be loaded.
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Options accepted by the {@link import("../client.js").NetRiskScanClient} constructor. */
export interface NetRiskScanClientOptions {
  /**
   * Developer API key, in the form `nrs_live_...`, created in the NetRiskScan developer console.
   *
   * Sent as `Authorization: Bearer <apiKey>`. It is never placed in a URL, and never appears in an
   * error message or stack - see the Security section of the README before using this in a browser.
   *
   * The SDK does **not** read `process.env` for you: pass the key explicitly so the client works
   * unchanged in browsers, Workers, and Deno.
   */
  apiKey: string;
  /** Base URL of the API. Defaults to `https://api.netriskscan.com`. Trailing slashes are trimmed. */
  baseUrl?: string;
  /**
   * Per-attempt request timeout in milliseconds. Defaults to `10000`.
   *
   * This budget applies to each attempt individually, not to the retry sequence as a whole. Timeouts
   * are never retried, so the worst case stays bounded at roughly `timeoutMs` plus any backoff already
   * spent on earlier retryable responses.
   */
  timeoutMs?: number;
  /**
   * Maximum automatic retries **after** the first attempt. Defaults to `2`, so at most 3 requests.
   *
   * Only idempotent methods and transient failures are ever retried - see
   * {@link import("../http/retry.js").isRetryableStatus}.
   */
  retries?: number;
  /**
   * Longest single backoff the SDK will wait before a retry, in milliseconds. Defaults to `10000`.
   *
   * A `Retry-After` longer than this is not slept through: the SDK stops retrying and throws
   * {@link import("../errors/index.js").NetRiskScanRateLimitError} with `retryAfter` set, so your code
   * decides how to handle a long wait rather than silently blocking on it.
   */
  maxRetryDelayMs?: number;
  /**
   * Value for the `User-Agent` header. Defaults to `@netriskscan/sdk/<version>`.
   *
   * Browsers forbid setting this header and silently ignore it; that is not an error.
   */
  userAgent?: string;
  /** Custom `fetch` implementation. Defaults to the runtime's global `fetch`. */
  fetch?: FetchLike;
}

/** Per-request options accepted by every client method. */
export interface RequestOptions {
  /**
   * Signal for caller-initiated cancellation.
   *
   * Composed with the SDK's own timeout rather than replacing it. If you abort, the original abort
   * reason is rethrown unchanged (an `AbortError` by default) - it is never reported as a NetRiskScan
   * server failure.
   */
  signal?: AbortSignal | undefined;
}

/** Per-request rate-limit snapshot, parsed from `X-RateLimit-*` response headers. */
export interface RateLimitInfo {
  /** Requests allowed per minute on the current plan. */
  limit?: number | undefined;
  /** Requests left in the current one-minute window. */
  remaining?: number | undefined;
  /** Unix timestamp (seconds) at which the current window resets. */
  reset?: number | undefined;
}

/** Per-request billing-period quota snapshot, parsed from `X-Quota-*` response headers. */
export interface QuotaInfo {
  /** Total query units the plan allows this billing period. */
  limit?: number | undefined;
  /** Units consumed this billing period. */
  used?: number | undefined;
  /** Units left this billing period. */
  remaining?: number | undefined;
}

/**
 * Transport-level metadata about one response.
 *
 * Not part of the API's JSON body. Read it with
 * {@link import("../http/rate-limit.js").getResponseMeta}, which never mutates the response data.
 */
export interface ResponseMeta {
  /** Trace ID from the `X-Request-Id` response header. */
  requestId?: string | undefined;
  /** Live rate-limit snapshot for this request. */
  rateLimit: RateLimitInfo;
  /** Live billing-period quota snapshot for this request. */
  quota: QuotaInfo;
  /** HTTP status of the response. */
  status: number;
}

/**
 * `error.code` values the Developer API is documented to return.
 *
 * Open-ended on purpose: an unrecognised code must surface as-is rather than break the client.
 */
export type NetRiskScanErrorCode =
  | "invalid_ip"
  | "invalid_request"
  | "unsupported_parameter"
  | "invalid_api_key"
  | "api_key_disabled"
  | "scope_not_allowed"
  | "not_found"
  | "feature_not_available"
  | "rate_limit_exceeded"
  | "quota_exceeded"
  | "temporarily_unavailable"
  | (string & {});

/** The API's error envelope: `{ "error": { "code", "message", "requestId" } }`. */
export interface ApiErrorBody {
  error: {
    code: NetRiskScanErrorCode;
    message: string;
    requestId?: string;
  };
}

/** One entry of {@link import("../client.js").NetRiskScanClient.checkMany}'s result. */
export type BatchResult<T> =
  { ip: string; ok: true; data: T } | { ip: string; ok: false; error: unknown };

/** Options for {@link import("../client.js").NetRiskScanClient.checkMany}. */
export interface CheckManyOptions extends RequestOptions {
  /**
   * Maximum requests in flight at once. Defaults to `5`.
   *
   * Keep this at or below your plan's concurrency ceiling (see `GET /v1/usage`); the helper does not
   * and must not try to work around the server's rate limits.
   */
  concurrency?: number;
}
