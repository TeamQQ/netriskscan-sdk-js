import { NetRiskScanConfigurationError, NetRiskScanValidationError } from "./errors/index.js";
import { performRequest, type RequestContext } from "./http/request.js";
import type {
  BatchResult,
  CheckManyOptions,
  NetRiskScanClientOptions,
  RequestOptions,
} from "./types/api.js";
import type { IpRiskResult } from "./types/risk.js";
import type { UsageResult } from "./types/usage.js";
import { isValidIp } from "./utils/ip.js";
import { VERSION } from "./version.js";

/** Production Developer API endpoint. */
const DEFAULT_BASE_URL = "https://api.netriskscan.com";

/** Per-attempt request budget. Comfortably above the API's normal latency, well under a stalled call. */
const DEFAULT_TIMEOUT_MS = 10_000;

/** Retries after the first attempt, so at most three requests for one call. */
const DEFAULT_RETRIES = 2;

/** Longest single backoff the SDK will sleep through before giving the decision back to the caller. */
const DEFAULT_MAX_RETRY_DELAY_MS = 10_000;

/** Concurrent requests {@link NetRiskScanClient.checkMany} runs, chosen to sit under the smallest plan. */
const DEFAULT_CONCURRENCY = 5;

/** `checkIp()` calls per day the anonymous tier allows, with no `apiKey` configured. */
const ANONYMOUS_DAILY_LIMIT = 30;

/**
 * Validates an optional `apiKey`.
 *
 * `undefined` is a deliberate choice - the anonymous tier - and passes through unchanged. Anything
 * else must be a non-blank string, so a caller who *meant* to authenticate (an unset environment
 * variable resolving to `""`, for instance) gets a clear configuration error instead of silently
 * falling back to anonymous.
 */
function normalizeApiKey(apiKey: string | undefined): string | undefined {
  if (apiKey === undefined) return undefined;
  if (typeof apiKey !== "string" || apiKey.trim() === "") {
    throw new NetRiskScanConfigurationError(
      "`apiKey` must be a non-empty string, or omitted entirely to use the API's anonymous tier " +
        `(${ANONYMOUS_DAILY_LIMIT} checkIp() calls/day, no getUsage() access). Create a key in the ` +
        "developer console for a higher limit: https://netriskscan.com",
    );
  }
  return apiKey.trim();
}

/**
 * Runs `worker` over `items` with at most `concurrency` in flight, preserving input order.
 *
 * A fixed pool of workers pulling from a shared cursor, rather than fixed-size chunks: one slow
 * request then delays only itself, instead of holding up a whole batch boundary.
 */
async function runPool<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function drain(): Promise<void> {
    for (;;) {
      const index = cursor++;
      const item = items[index];
      if (index >= items.length || item === undefined) return;
      results[index] = await worker(item, index);
    }
  }

  const workers = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workers }, () => drain()));
  return results;
}

/**
 * Client for the NetRiskScan Developer API.
 *
 * Talks only to the public `/v1/*` surface. Every risk verdict below is computed and published by
 * NetRiskScan; the SDK transports and types it, and never scores anything locally.
 *
 * @example
 * ```ts
 * import { NetRiskScanClient } from "@netriskscan/sdk";
 *
 * const client = new NetRiskScanClient({ apiKey: process.env.NETRISKSCAN_API_KEY! });
 * const result = await client.checkIp("8.8.8.8");
 *
 * console.log(result.risk.index, result.risk.band);
 * ```
 *
 * `apiKey` may be omitted to use the anonymous tier instead - 30 `checkIp()` calls/day, no
 * `getUsage()`:
 *
 * ```ts
 * const client = new NetRiskScanClient({});
 * const result = await client.checkIp("8.8.8.8");
 * console.log(result.usage); // { mode: "anonymous", dailyLimit: 30, remaining: 29, ... }
 * ```
 */
export class NetRiskScanClient {
  readonly #context: RequestContext;

  /** Base URL this client sends to, with any trailing slash removed. */
  readonly baseUrl: string;

  constructor(options: NetRiskScanClientOptions = {}) {
    const apiKey = normalizeApiKey(options.apiKey);

    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      throw new NetRiskScanConfigurationError(
        "No global `fetch` is available in this runtime. Use Node.js 20+, or pass a `fetch` " +
          "implementation via `new NetRiskScanClient({ fetch })`.",
      );
    }

    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");

    this.#context = {
      apiKey,
      baseUrl: this.baseUrl,
      timeoutMs: positive(options.timeoutMs, DEFAULT_TIMEOUT_MS, "timeoutMs"),
      retries: nonNegative(options.retries, DEFAULT_RETRIES, "retries"),
      maxRetryDelayMs: nonNegative(
        options.maxRetryDelayMs,
        DEFAULT_MAX_RETRY_DELAY_MS,
        "maxRetryDelayMs",
      ),
      userAgent: options.userAgent ?? `@netriskscan/sdk/${VERSION}`,
      // Unbound, so an implementation that relies on `this` (a browser's global `fetch`) keeps working.
      fetch: (input, init) => fetchImpl(input, init),
    };
  }

  /**
   * Looks up risk and network intelligence for one IP address.
   *
   * `GET /v1/ip-risk/{ip}` - requires the `ip-risk:read` scope, and consumes one query unit per call,
   * cache hits included.
   *
   * An address that cannot be scored at all (loopback, private, reserved) is **not** an error: the API
   * answers `200` with `risk.index === null` and `risk.assessmentGrade === "insufficient"`.
   *
   * @throws {NetRiskScanValidationError} if `ip` is not a syntactically valid IPv4 or IPv6 address, in
   * which case no request is sent and no unit is spent.
   * @throws {NetRiskScanAuthenticationError} on `401` / `403`.
   * @throws {NetRiskScanRateLimitError} on `429`, after retries are exhausted.
   * @throws {NetRiskScanApiError} on any other non-2xx status.
   */
  async checkIp(ip: string, options: RequestOptions = {}): Promise<IpRiskResult> {
    if (!isValidIp(ip)) {
      throw new NetRiskScanValidationError(`"${String(ip)}" is not a valid IPv4 or IPv6 address.`, {
        code: "invalid_ip",
      });
    }

    return performRequest<IpRiskResult>(
      this.#context,
      "GET",
      `/v1/ip-risk/${encodeURIComponent(ip.trim())}`,
      options,
    );
  }

  /**
   * Reads the account's plan, billing-period usage, and rate-limit ceiling.
   *
   * `GET /v1/usage` - requires the `usage:read` scope, and consumes no query units.
   *
   * Every `/v1/*` response also carries a live snapshot in its headers, reachable with
   * {@link getResponseMeta} - so watching headroom does not require polling this endpoint.
   *
   * @throws {NetRiskScanValidationError} if the client has no `apiKey` configured. There is no
   * account to report usage for on the anonymous tier - read `checkIp()`'s own `usage` field, or
   * {@link getResponseMeta}, instead.
   */
  async getUsage(options: RequestOptions = {}): Promise<UsageResult> {
    if (this.#context.apiKey === undefined) {
      throw new NetRiskScanValidationError(
        "getUsage() requires an API key - the anonymous tier has no account to report usage for. " +
          "Read the `usage` field on checkIp()'s result, or getResponseMeta(), instead.",
      );
    }

    return performRequest<UsageResult>(this.#context, "GET", "/v1/usage", options);
  }

  /**
   * Convenience helper that looks up several addresses with bounded concurrency.
   *
   * **This is a client-side loop, not a batch endpoint.** It issues one `GET /v1/ip-risk/{ip}` per
   * address and therefore spends one query unit per address; the Developer API has no batch route
   * today. Keep `concurrency` at or below your plan's ceiling (see {@link checkIp} and `getUsage`).
   *
   * Results come back in input order, one entry per address, and a single failure never discards the
   * addresses that succeeded:
   *
   * ```ts
   * for (const entry of await client.checkMany(["8.8.8.8", "1.1.1.1"])) {
   *   if (entry.ok) console.log(entry.ip, entry.data.risk.band);
   *   else console.error(entry.ip, entry.error);
   * }
   * ```
   */
  async checkMany(
    ips: readonly string[],
    options: CheckManyOptions = {},
  ): Promise<BatchResult<IpRiskResult>[]> {
    const { concurrency = DEFAULT_CONCURRENCY, ...requestOptions } = options;
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new NetRiskScanValidationError("`concurrency` must be an integer of at least 1.");
    }

    return runPool(ips, concurrency, async (ip): Promise<BatchResult<IpRiskResult>> => {
      try {
        return { ip, ok: true, data: await this.checkIp(ip, requestOptions) };
      } catch (error) {
        return { ip, ok: false, error };
      }
    });
  }
}

function positive(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) {
    throw new NetRiskScanConfigurationError(`\`${name}\` must be a positive number.`);
  }
  return value;
}

function nonNegative(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0) {
    throw new NetRiskScanConfigurationError(`\`${name}\` must be a non-negative number.`);
  }
  return value;
}
