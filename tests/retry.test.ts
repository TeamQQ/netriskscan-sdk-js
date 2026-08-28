import { describe, expect, it } from "vitest";
import type { FetchLike } from "../src/index.js";
import {
  NetRiskScanApiError,
  NetRiskScanClient,
  NetRiskScanRateLimitError,
  NetRiskScanTimeoutError,
} from "../src/index.js";
import { computeBackoffMs, isRetryableMethod, isRetryableStatus } from "../src/http/retry.js";
import { IP_RISK_BODY, TEST_API_KEY, errorBody, failingFetch, stubFetch } from "./helpers.js";

function client(fetch: FetchLike, options: Record<string, unknown> = {}) {
  return new NetRiskScanClient({ apiKey: TEST_API_KEY, fetch, retries: 2, ...options });
}

describe("retry policy", () => {
  it.each([429, 502, 503, 504])("treats %i as retryable", (status) => {
    expect(isRetryableStatus(status)).toBe(true);
  });

  it.each([400, 401, 403, 404, 409, 422, 500, 501])("treats %i as final", (status) => {
    expect(isRetryableStatus(status)).toBe(false);
  });

  it("allows automatic retries only for idempotent methods", () => {
    expect(isRetryableMethod("GET")).toBe(true);
    expect(isRetryableMethod("get")).toBe(true);
    expect(isRetryableMethod("HEAD")).toBe(true);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(isRetryableMethod(method)).toBe(false);
    }
  });
});

describe("backoff", () => {
  it("grows exponentially from a 250ms base, with jitter on top", () => {
    for (const [attempt, min, max] of [
      [1, 250, 313],
      [2, 500, 625],
      [3, 1000, 1250],
    ] as const) {
      for (let i = 0; i < 50; i += 1) {
        const delay = computeBackoffMs(attempt);
        expect(delay).toBeGreaterThanOrEqual(min);
        expect(delay).toBeLessThanOrEqual(max);
      }
    }
  });

  it("prefers the server's Retry-After over its own schedule", () => {
    expect(computeBackoffMs(1, 3)).toBe(3000);
    expect(computeBackoffMs(5, 0)).toBe(0);
  });

  it("ignores a nonsensical Retry-After and falls back to the schedule", () => {
    expect(computeBackoffMs(1, -5)).toBeGreaterThanOrEqual(250);
    expect(computeBackoffMs(1, Number.NaN)).toBeGreaterThanOrEqual(250);
  });
});

describe("automatic retries", () => {
  it("retries a 429 and returns the eventual success", async () => {
    const stub = stubFetch(
      { status: 429, body: errorBody("rate_limit_exceeded", "slow down") },
      { body: IP_RISK_BODY },
    );
    const result = await client(stub.fetch).checkIp("8.8.8.8");

    expect(stub.calls).toHaveLength(2);
    expect(result.risk.band).toBe("excellent");
  });

  it("retries a 503 and returns the eventual success", async () => {
    const stub = stubFetch(
      { status: 503, body: errorBody("temporarily_unavailable", "try later") },
      { body: IP_RISK_BODY },
    );
    await client(stub.fetch).checkIp("8.8.8.8");
    expect(stub.calls).toHaveLength(2);
  });

  it.each([502, 504])("retries a %i from the edge", async (status) => {
    const stub = stubFetch(
      { status, body: errorBody("temporarily_unavailable", "bad gateway") },
      { body: IP_RISK_BODY },
    );
    await client(stub.fetch).checkIp("8.8.8.8");
    expect(stub.calls).toHaveLength(2);
  });

  it.each([400, 401, 403, 404, 422])("never retries a %i", async (status) => {
    const stub = stubFetch({ status, body: errorBody("nope", `status ${status}`) });
    await expect(client(stub.fetch).checkIp("8.8.8.8")).rejects.toThrow();
    expect(stub.calls).toHaveLength(1);
  });

  it("stops after `retries` extra attempts and throws the last error", async () => {
    const stub = stubFetch({ status: 503, body: errorBody("temporarily_unavailable", "down") });
    const error = await client(stub.fetch, { retries: 2 })
      .checkIp("8.8.8.8")
      .catch((e: unknown) => e);

    expect(stub.calls).toHaveLength(3);
    expect(error).toBeInstanceOf(NetRiskScanApiError);
    expect(error).toMatchObject({ status: 503 });
  });

  it("makes exactly one attempt when retries is 0", async () => {
    const stub = stubFetch({ status: 503, body: errorBody("temporarily_unavailable", "down") });
    await expect(client(stub.fetch, { retries: 0 }).getUsage()).rejects.toThrow();
    expect(stub.calls).toHaveLength(1);
  });

  it("honours Retry-After when it fits inside maxRetryDelayMs", async () => {
    const started = Date.now();
    const stub = stubFetch(
      {
        status: 429,
        body: errorBody("rate_limit_exceeded", "slow down"),
        headers: { "retry-after": "1" },
      },
      { body: IP_RISK_BODY },
    );

    await client(stub.fetch, { maxRetryDelayMs: 5_000 }).checkIp("8.8.8.8");

    expect(stub.calls).toHaveLength(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(950);
  });

  it("stops immediately when Retry-After exceeds maxRetryDelayMs, rather than blocking", async () => {
    const started = Date.now();
    const stub = stubFetch({
      status: 429,
      body: errorBody("rate_limit_exceeded", "slow down"),
      headers: { "retry-after": "600" },
    });

    const error = await client(stub.fetch, { maxRetryDelayMs: 1_000 })
      .checkIp("8.8.8.8")
      .catch((e: unknown) => e);

    expect(stub.calls).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(500);
    expect(error).toBeInstanceOf(NetRiskScanRateLimitError);
    expect((error as NetRiskScanRateLimitError).retryAfter).toBe(600);
  });

  it("retries a transport failure, which says nothing about the request", async () => {
    let attempts = 0;
    const instance = client((url, init) => {
      attempts += 1;
      if (attempts === 1) return Promise.reject(new TypeError("fetch failed"));
      return stubFetch({ body: IP_RISK_BODY }).fetch(url, init);
    });

    await expect(instance.checkIp("8.8.8.8")).resolves.toMatchObject({
      requestId: expect.any(String),
    });
    expect(attempts).toBe(2);
  });

  it("gives up on a persistent transport failure after the configured retries", async () => {
    const stub = failingFetch(new TypeError("fetch failed"));
    await expect(client(stub.fetch, { retries: 2 }).getUsage()).rejects.toThrow();
    expect(stub.calls).toHaveLength(3);
  });

  it("never retries a timeout, so the caller's budget stays honoured", async () => {
    let attempts = 0;
    const instance = client(
      (_url, init) => {
        attempts += 1;
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        });
      },
      { timeoutMs: 20, retries: 3 },
    );

    await expect(instance.checkIp("8.8.8.8")).rejects.toThrow(NetRiskScanTimeoutError);
    expect(attempts).toBe(1);
  });
});
