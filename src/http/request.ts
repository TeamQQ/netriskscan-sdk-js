import {
  NetRiskScanApiError,
  NetRiskScanAuthenticationError,
  NetRiskScanNetworkError,
  NetRiskScanRateLimitError,
  NetRiskScanTimeoutError,
} from "../errors/index.js";
import type { NetRiskScanError } from "../errors/index.js";
import type { FetchLike, NetRiskScanErrorCode, RequestOptions } from "../types/api.js";
import { delay, linkAbortSignals } from "../utils/abort.js";
import {
  attachResponseMeta,
  buildResponseMeta,
  parseQuota,
  parseRateLimit,
  parseRetryAfter,
} from "./rate-limit.js";
import { computeBackoffMs, isRetryableMethod, isRetryableStatus } from "./retry.js";

/** Everything the request core needs, resolved once by the client. */
export interface RequestContext {
  /** `undefined` means the anonymous tier - no `Authorization` header is sent. */
  apiKey: string | undefined;
  baseUrl: string;
  timeoutMs: number;
  retries: number;
  maxRetryDelayMs: number;
  userAgent: string;
  fetch: FetchLike;
}

/**
 * A parsed error body.
 *
 * The Developer API's documented envelope is `{ "error": { code, message, requestId } }`, produced by
 * both the edge gateway and the origin. The origin's *global* limiter can also answer `429` with the
 * website's envelope (`{ success, code, message, traceId }`), so both shapes are read here rather than
 * letting a real rate-limit answer degrade into an unexplained failure.
 */
interface ParsedErrorBody {
  code?: NetRiskScanErrorCode | undefined;
  message?: string | undefined;
  requestId?: string | undefined;
  /**
   * The website envelope's `traceId`, kept separate from {@link requestId}.
   *
   * It is an ASP.NET `TraceIdentifier` (`0HN7GK4J2P8QR:00000001`), not the `req_…` ID support asks
   * for, so it must rank *below* the `X-Request-Id` header rather than shadowing it.
   */
  traceId?: string | undefined;
}

/** The outcome of one attempt: either a value to return, or a signal to retry after a backoff. */
type Attempt<T> = { done: true; value: T } | { done: false; backoffMs: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function parseErrorBody(payload: unknown): ParsedErrorBody {
  if (!isRecord(payload)) return {};

  const nested = payload["error"];
  if (isRecord(nested)) {
    return {
      code: asString(nested["code"]),
      message: asString(nested["message"]),
      requestId: asString(nested["requestId"]),
    };
  }

  return {
    code: asString(payload["code"]),
    message: asString(payload["message"]),
    requestId: asString(payload["requestId"]),
    traceId: asString(payload["traceId"]),
  };
}

async function readErrorBody(response: Response): Promise<ParsedErrorBody> {
  try {
    return parseErrorBody(await response.json());
  } catch {
    // A gateway or proxy can answer with HTML or an empty body; the status still carries the meaning.
    return {};
  }
}

/** `true` when a rejected `fetch` (or body read) is an abort rather than a transport failure. */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

/**
 * Appended to a `429` message when the request that hit it had no `apiKey` - the anonymous tier's
 * own daily counter, not the account rate limit or quota an authenticated caller would see.
 */
const ANONYMOUS_LIMIT_HINT =
  " This request had no apiKey, so it was billed against the anonymous tier's 30-requests/day " +
  "limit. Create a free API key at https://netriskscan.com for a higher limit.";

function buildHttpError(
  response: Response,
  body: ParsedErrorBody,
  retryAfter: number | undefined,
  isAnonymous: boolean,
): NetRiskScanError {
  // The edge gateway stamps `X-Request-Id` on every response and forces the same value on the origin,
  // so the header is the ID NetRiskScan support can actually trace. It outranks the website envelope's
  // `traceId`, which only appears on the origin limiter's non-standard `429` and is a different
  // identifier entirely.
  const requestId =
    body.requestId ?? response.headers.get("x-request-id") ?? body.traceId ?? undefined;
  const message = body.message ?? `NetRiskScan API request failed with status ${response.status}.`;
  const shared = { status: response.status, code: body.code, requestId };

  if (response.status === 401 || response.status === 403) {
    return new NetRiskScanAuthenticationError(message, shared);
  }

  if (response.status === 429) {
    return new NetRiskScanRateLimitError(isAnonymous ? message + ANONYMOUS_LIMIT_HINT : message, {
      ...shared,
      retryAfter,
      rateLimit: parseRateLimit(response.headers),
      quota: parseQuota(response.headers),
    });
  }

  return new NetRiskScanApiError(message, shared);
}

/** Turns a rejected `fetch` or body read into the error class that describes what actually happened. */
function translateTransportError(
  error: unknown,
  context: RequestContext,
  options: RequestOptions,
  linked: { timedOut: () => boolean },
): unknown {
  // Checked before the error is inspected at all, because `abort(reason)` lets a caller reject with
  // any value they like - a plain `Error`, a string, a custom class. Sniffing for `name === "AbortError"`
  // first would misfile every one of those as a transport failure. If the caller's signal is aborted,
  // the outcome is theirs whatever shape it arrived in: rethrow it untouched, so `signal.reason` and
  // `err.name === "AbortError"` both behave as expected.
  if (options.signal?.aborted === true) return error;

  if (isAbortError(error)) {
    if (linked.timedOut()) {
      // Retrying a timeout would multiply the caller's stated budget by the retry count, so the budget
      // is honoured as written and the timeout surfaces immediately.
      return new NetRiskScanTimeoutError(
        `NetRiskScan API request timed out after ${context.timeoutMs}ms.`,
        { timeoutMs: context.timeoutMs, cause: error },
      );
    }
  }

  return new NetRiskScanNetworkError(
    error instanceof Error
      ? `NetRiskScan API request failed: ${error.message}`
      : "NetRiskScan API request failed.",
    { cause: error },
  );
}

/**
 * Runs one attempt end to end, under a single timeout that also covers reading the body.
 *
 * Returns `{ done: false }` when the failure is transient and a retry is still allowed; throws in
 * every other failing case.
 */
async function runAttempt<T>(
  context: RequestContext,
  method: "GET",
  url: string,
  options: RequestOptions,
  attempt: number,
  canRetry: boolean,
): Promise<Attempt<T>> {
  // Held for the whole attempt, body read included: a server that answers headers promptly and then
  // stalls mid-body is exactly the case a timeout exists for.
  const linked = linkAbortSignals(context.timeoutMs, options.signal);

  try {
    let response: Response;
    try {
      response = await context.fetch(url, {
        method,
        headers: {
          // Omitted entirely (not sent as `Bearer undefined`) on the anonymous tier.
          ...(context.apiKey === undefined ? {} : { Authorization: `Bearer ${context.apiKey}` }),
          Accept: "application/json",
          // Browsers forbid setting this and drop it silently; that is not an error anywhere.
          "User-Agent": context.userAgent,
        },
        signal: linked.signal,
        redirect: "follow",
      });
    } catch (error) {
      throw translateTransportError(error, context, options, linked);
    }

    if (response.ok) {
      let data: unknown;
      try {
        data = await response.json();
      } catch (error) {
        if (isAbortError(error)) throw translateTransportError(error, context, options, linked);
        throw new NetRiskScanNetworkError("NetRiskScan API returned a malformed JSON response.", {
          status: response.status,
          requestId: response.headers.get("x-request-id") ?? undefined,
          cause: error,
        });
      }

      if (!isRecord(data)) {
        throw new NetRiskScanNetworkError(
          "NetRiskScan API returned an unexpected response shape.",
          {
            status: response.status,
            requestId: response.headers.get("x-request-id") ?? undefined,
          },
        );
      }

      return { done: true, value: attachResponseMeta(data, buildResponseMeta(response)) as T };
    }

    // Always drained, so a keep-alive connection is released rather than left half-read.
    const body = await readErrorBody(response);
    const retryAfter = parseRetryAfter(response.headers);

    if (canRetry && isRetryableStatus(response.status)) {
      const backoffMs = computeBackoffMs(attempt, retryAfter);
      // A `Retry-After` beyond the configured ceiling is respected by *stopping*, not by blocking the
      // caller for minutes. The error carries `retryAfter` so they can schedule the wait themselves.
      if (backoffMs <= context.maxRetryDelayMs) {
        return { done: false, backoffMs };
      }
    }

    throw buildHttpError(response, body, retryAfter, context.apiKey === undefined);
  } finally {
    linked.dispose();
  }
}

/**
 * Performs one API call, with timeout, cancellation, and bounded automatic retries.
 *
 * No query string is ever appended: the edge gateway rejects any query parameter on `/v1/*` with
 * `400`, so per-request options travel in headers or not at all.
 */
export async function performRequest<T>(
  context: RequestContext,
  method: "GET",
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const url = `${context.baseUrl}${path}`;
  const maxAttempts = isRetryableMethod(method) ? context.retries + 1 : 1;

  for (let attempt = 1; ; attempt += 1) {
    let outcome: Attempt<T>;
    try {
      outcome = await runAttempt<T>(context, method, url, options, attempt, attempt < maxAttempts);
    } catch (error) {
      // Transport failures are the one class worth repeating blind: a reset connection says nothing
      // about the request, unlike a 4xx the server deliberately chose.
      if (error instanceof NetRiskScanNetworkError && attempt < maxAttempts) {
        await delay(computeBackoffMs(attempt), options.signal);
        continue;
      }
      throw error;
    }

    if (outcome.done) return outcome.value;
    await delay(outcome.backoffMs, options.signal);
  }
}
