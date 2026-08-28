/** The SDK's retry policy: which failures are worth repeating, and how long to wait first. */

/** HTTP methods safe to repeat. */
const IDEMPOTENT_METHODS = new Set(["GET", "HEAD"]);

/** First backoff step; each subsequent retry doubles it - 250ms, 500ms, 1000ms, ... */
const BASE_DELAY_MS = 250;

/** Jitter added to each backoff, as a fraction of that step, to keep retrying clients from resynchronising. */
const JITTER_RATIO = 0.25;

/**
 * Whether a method may be retried automatically.
 *
 * Only idempotent methods qualify. The `/v1` surface is entirely `GET` today; this gate exists so that
 * adding a non-idempotent endpoint later cannot silently inherit automatic retries and double-charge a
 * caller's quota.
 */
export function isRetryableMethod(method: string): boolean {
  return IDEMPOTENT_METHODS.has(method.toUpperCase());
}

/**
 * Whether a status is worth retrying.
 *
 * `429` (rate limit or quota), and the transient upstream statuses `502` / `503` / `504`. Never `400`,
 * `401`, `403`, `404`, `409`, or `422`: those describe the request itself, and repeating it only
 * wastes time and, for `429`-adjacent paths, goodwill.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

/**
 * Exponential backoff with jitter, honouring `Retry-After` when the server sent one.
 *
 * @param attempt - 1 for the first retry, 2 for the second, and so on.
 * @param retryAfterSeconds - the parsed `Retry-After` header, if any.
 */
export function computeBackoffMs(attempt: number, retryAfterSeconds?: number): number {
  if (
    retryAfterSeconds !== undefined &&
    Number.isFinite(retryAfterSeconds) &&
    retryAfterSeconds >= 0
  ) {
    // The server knows when its window resets; a guess derived from the attempt number does not.
    return Math.ceil(retryAfterSeconds * 1000);
  }
  const step = BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1);
  return Math.round(step + Math.random() * step * JITTER_RATIO);
}
