import type { NetRiskScanErrorCode, QuotaInfo, RateLimitInfo } from "../types/api.js";

/** Fields every {@link NetRiskScanError} can carry. */
export interface NetRiskScanErrorOptions {
  /** HTTP status, when the failure came from an HTTP response. */
  status?: number | undefined;
  /** Machine-readable `error.code` from the API, when one was returned. */
  code?: NetRiskScanErrorCode | undefined;
  /** Trace ID for the failed request. Quote it when contacting NetRiskScan support. */
  requestId?: string | undefined;
  /** Underlying error, when this one wraps another. */
  cause?: unknown;
}

/**
 * Base class for every error this SDK throws.
 *
 * `instanceof NetRiskScanError` matches all of them, so a single `catch` can separate SDK failures
 * from bugs in your own code.
 *
 * Errors never contain the API key, the `Authorization` header, or any server-internal detail.
 */
export class NetRiskScanError extends Error {
  /** HTTP status, when the failure came from an HTTP response. */
  readonly status?: number | undefined;
  /** Machine-readable `error.code` from the API, when one was returned. */
  readonly code?: NetRiskScanErrorCode | undefined;
  /** Trace ID for the failed request. */
  readonly requestId?: string | undefined;

  constructor(message: string, options: NetRiskScanErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.status = options.status;
    this.code = options.code;
    this.requestId = options.requestId;
    // Restores the prototype chain when the package is consumed from a downlevel (ES5/ES2015) build,
    // where `extends Error` otherwise breaks `instanceof`.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * The client is misconfigured - most often a missing or malformed API key, or an unusable `baseUrl`.
 *
 * Thrown from the constructor, before any network call is attempted.
 */
export class NetRiskScanConfigurationError extends NetRiskScanError {}

/**
 * An argument failed the SDK's own basic checks, so no request was sent.
 *
 * Only obviously-invalid input is rejected here (`""`, `"abc"`, `"999.999.999.999"`). The server
 * remains the authority on what is a valid address; this exists to avoid pointless billed round trips.
 */
export class NetRiskScanValidationError extends NetRiskScanError {}

/**
 * `401` or `403` - the API key is missing, invalid, disabled, revoked, expired, or lacks the scope the
 * endpoint requires (`ip-risk:read`, `usage:read`).
 *
 * Never retried: retrying cannot make a rejected credential valid.
 */
export class NetRiskScanAuthenticationError extends NetRiskScanError {}

/** Extra fields carried by {@link NetRiskScanRateLimitError}. */
export interface NetRiskScanRateLimitErrorOptions extends NetRiskScanErrorOptions {
  /** Seconds to wait before retrying, from the `Retry-After` response header. */
  retryAfter?: number | undefined;
  /** Rate-limit snapshot from the `X-RateLimit-*` headers on the rejecting response. */
  rateLimit?: RateLimitInfo | undefined;
  /** Quota snapshot from the `X-Quota-*` headers on the rejecting response. */
  quota?: QuotaInfo | undefined;
}

/**
 * `429` - the per-minute rate limit (`rate_limit_exceeded`) or the billing-period quota
 * (`quota_exceeded`) is exhausted. Check {@link NetRiskScanError.code} to tell them apart.
 *
 * Reaching this means the SDK's own retries were exhausted, or the server asked for a longer wait than
 * `maxRetryDelayMs` allows. Back off for at least {@link retryAfter} seconds - do not work around the
 * limit.
 */
export class NetRiskScanRateLimitError extends NetRiskScanError {
  /** Seconds to wait before retrying, when the server sent `Retry-After`. */
  readonly retryAfter?: number | undefined;
  /** Rate-limit snapshot from the rejecting response. */
  readonly rateLimit: RateLimitInfo;
  /** Quota snapshot from the rejecting response. */
  readonly quota: QuotaInfo;

  constructor(message: string, options: NetRiskScanRateLimitErrorOptions = {}) {
    super(message, options);
    this.retryAfter = options.retryAfter;
    this.rateLimit = options.rateLimit ?? {};
    this.quota = options.quota ?? {};
  }
}

/**
 * A non-2xx response that no more specific error class covers - `400`, `404`, `409`, `422`, `5xx`, and
 * any future status.
 *
 * {@link NetRiskScanError.status} and {@link NetRiskScanError.code} carry what the server reported.
 */
export class NetRiskScanApiError extends NetRiskScanError {}

/** Extra fields carried by {@link NetRiskScanTimeoutError}. */
export interface NetRiskScanTimeoutErrorOptions extends NetRiskScanErrorOptions {
  /** The per-attempt budget that elapsed, in milliseconds. */
  timeoutMs: number;
}

/**
 * The per-attempt `timeoutMs` budget elapsed before the server responded.
 *
 * Distinct from a caller-initiated abort, which rethrows your own abort reason untouched, and from
 * {@link NetRiskScanNetworkError}, which means the request never completed for transport reasons.
 * Timeouts are not retried automatically.
 */
export class NetRiskScanTimeoutError extends NetRiskScanError {
  /** The per-attempt budget that elapsed, in milliseconds. */
  readonly timeoutMs: number;

  constructor(message: string, options: NetRiskScanTimeoutErrorOptions) {
    super(message, options);
    this.timeoutMs = options.timeoutMs;
  }
}

/**
 * The request never produced an HTTP response - DNS failure, connection reset, TLS error, offline
 * host, or an unreadable response body.
 *
 * The originating error is available on `cause`.
 */
export class NetRiskScanNetworkError extends NetRiskScanError {}
