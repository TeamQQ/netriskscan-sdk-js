import { describe, expect, it } from "vitest";
import {
  NetRiskScanApiError,
  NetRiskScanAuthenticationError,
  NetRiskScanClient,
  NetRiskScanError,
  NetRiskScanNetworkError,
  NetRiskScanRateLimitError,
  NetRiskScanTimeoutError,
} from "../src/index.js";
import type { FetchLike } from "../src/index.js";
import { TEST_API_KEY, errorBody, failingFetch, stubFetch } from "./helpers.js";

function client(fetch: FetchLike, options: Record<string, unknown> = {}) {
  return new NetRiskScanClient({ apiKey: TEST_API_KEY, fetch, retries: 0, ...options });
}

describe("HTTP status mapping", () => {
  it.each([
    [400, "invalid_ip", NetRiskScanApiError],
    [400, "unsupported_parameter", NetRiskScanApiError],
    [401, "invalid_api_key", NetRiskScanAuthenticationError],
    [403, "api_key_disabled", NetRiskScanAuthenticationError],
    [403, "scope_not_allowed", NetRiskScanAuthenticationError],
    [404, "not_found", NetRiskScanApiError],
    [404, "feature_not_available", NetRiskScanApiError],
    [409, "conflict", NetRiskScanApiError],
    [422, "unprocessable", NetRiskScanApiError],
    [429, "rate_limit_exceeded", NetRiskScanRateLimitError],
    [429, "quota_exceeded", NetRiskScanRateLimitError],
    [500, "internal_error", NetRiskScanApiError],
    [502, "temporarily_unavailable", NetRiskScanApiError],
    [503, "temporarily_unavailable", NetRiskScanApiError],
    [504, "temporarily_unavailable", NetRiskScanApiError],
  ])("maps %i %s to the right error class", async (status, code, expected) => {
    const stub = stubFetch({ status, body: errorBody(code, `failed with ${status}`) });
    const error = await client(stub.fetch)
      .checkIp("8.8.8.8")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(expected);
    expect(error).toBeInstanceOf(NetRiskScanError);
    expect(error).toMatchObject({ status, code, message: `failed with ${status}` });
  });

  it("carries the requestId from the error body into the thrown error", async () => {
    const stub = stubFetch({
      status: 403,
      body: errorBody(
        "scope_not_allowed",
        "The API key does not allow usage reads.",
        "req_abc12345",
      ),
    });
    await expect(client(stub.fetch).getUsage()).rejects.toMatchObject({
      requestId: "req_abc12345",
    });
  });

  it("falls back to the X-Request-Id header when the body carries no requestId", async () => {
    const stub = stubFetch({
      status: 500,
      body: { error: { code: "internal_error", message: "boom" } },
      headers: { "x-request-id": "req_fromheader" },
    });
    await expect(client(stub.fetch).getUsage()).rejects.toMatchObject({
      requestId: "req_fromheader",
    });
  });

  it("still produces a typed error when the body is not the documented envelope", async () => {
    const stub = stubFetch({ status: 503, rawBody: "<html>502 Bad Gateway</html>" });
    const error = await client(stub.fetch)
      .getUsage()
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NetRiskScanApiError);
    expect(error).toMatchObject({ status: 503, code: undefined });
    expect((error as Error).message).toContain("503");
  });

  it("reads the website envelope the origin's global limiter can return for 429", async () => {
    // `{ success, code, message, traceId }` rather than `{ error: { ... } }` - see request.ts.
    const stub = stubFetch({
      status: 429,
      body: {
        success: false,
        code: "CLIENT_RATE_LIMITED",
        message: "Too many requests from your network.",
        traceId: "0HN7GK4J2P8QR:00000001",
      },
    });
    const error = await client(stub.fetch)
      .getUsage()
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NetRiskScanRateLimitError);
    expect(error).toMatchObject({ code: "CLIENT_RATE_LIMITED" });
  });

  it("prefers the gateway's X-Request-Id over the envelope's ASP.NET traceId", async () => {
    // The global limiter sends an ASP.NET TraceIdentifier, which is not the `req_` ID support traces
    // by. The edge gateway's header is, so it must win.
    const stub = stubFetch({
      status: 429,
      body: { success: false, code: "CLIENT_RATE_LIMITED", traceId: "0HN7GK4J2P8QR:00000001" },
      headers: { "x-request-id": "req_gateway00000001" },
    });
    await expect(client(stub.fetch).getUsage()).rejects.toMatchObject({
      requestId: "req_gateway00000001",
    });
  });

  it("falls back to traceId only when no header is present", async () => {
    const stub = stubFetch({
      status: 429,
      body: { success: false, code: "CLIENT_RATE_LIMITED", traceId: "0HN7GK4J2P8QR:00000001" },
    });
    await expect(client(stub.fetch).getUsage()).rejects.toMatchObject({
      requestId: "0HN7GK4J2P8QR:00000001",
    });
  });

  it("still lets the documented envelope's requestId win over the header", async () => {
    const stub = stubFetch({
      status: 403,
      body: errorBody("scope_not_allowed", "denied", "req_frombody000001"),
      headers: { "x-request-id": "req_fromheader00001" },
    });
    await expect(client(stub.fetch).getUsage()).rejects.toMatchObject({
      requestId: "req_frombody000001",
    });
  });
});

describe("rate-limit errors", () => {
  it("exposes Retry-After and the rate-limit and quota snapshots", async () => {
    const stub = stubFetch({
      status: 429,
      body: errorBody("quota_exceeded", "API quota exceeded."),
      headers: {
        "retry-after": "45",
        "x-ratelimit-limit": "120",
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": "1793491200",
        "x-quota-limit": "50000",
        "x-quota-used": "50000",
        "x-quota-remaining": "0",
      },
    });

    const error = await client(stub.fetch)
      .checkIp("8.8.8.8")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NetRiskScanRateLimitError);
    const rateLimitError = error as NetRiskScanRateLimitError;
    expect(rateLimitError.retryAfter).toBe(45);
    expect(rateLimitError.code).toBe("quota_exceeded");
    expect(rateLimitError.rateLimit).toEqual({ limit: 120, remaining: 0, reset: 1793491200 });
    expect(rateLimitError.quota).toEqual({ limit: 50000, used: 50000, remaining: 0 });
  });

  it("defaults the snapshots to empty objects when no headers are sent", async () => {
    const stub = stubFetch({ status: 429, body: errorBody("rate_limit_exceeded", "slow down") });
    const error = (await client(stub.fetch)
      .getUsage()
      .catch((e: unknown) => e)) as NetRiskScanRateLimitError;

    expect(error.rateLimit).toEqual({ limit: undefined, remaining: undefined, reset: undefined });
    expect(error.retryAfter).toBeUndefined();
  });
});

describe("transport errors", () => {
  it("wraps a failed fetch in a network error", async () => {
    const stub = failingFetch(new TypeError("fetch failed"));
    const error = await client(stub.fetch)
      .checkIp("8.8.8.8")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NetRiskScanNetworkError);
    expect((error as Error).cause).toBeInstanceOf(TypeError);
  });

  it("reports an elapsed budget as a timeout, not a server failure", async () => {
    const instance = client(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        }),
      { timeoutMs: 20 },
    );

    const error = await instance.checkIp("8.8.8.8").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NetRiskScanTimeoutError);
    expect((error as NetRiskScanTimeoutError).timeoutMs).toBe(20);
    expect(error).not.toBeInstanceOf(NetRiskScanNetworkError);
  });
});

describe("error hygiene", () => {
  it("never leaks the API key into the message, stack, or serialised error", async () => {
    const stub = stubFetch({ status: 401, body: errorBody("invalid_api_key", "Invalid API key.") });
    const error = (await client(stub.fetch)
      .checkIp("8.8.8.8")
      .catch((e: unknown) => e)) as Error;

    expect(error.message).not.toContain(TEST_API_KEY);
    expect(error.stack ?? "").not.toContain(TEST_API_KEY);
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(TEST_API_KEY);
  });

  it("gives every error class a usable name and a shared base type", () => {
    const cases: NetRiskScanError[] = [
      new NetRiskScanError("base"),
      new NetRiskScanApiError("api"),
      new NetRiskScanAuthenticationError("auth"),
      new NetRiskScanRateLimitError("rate"),
      new NetRiskScanNetworkError("network"),
      new NetRiskScanTimeoutError("timeout", { timeoutMs: 1 }),
    ];

    for (const error of cases) {
      expect(error).toBeInstanceOf(NetRiskScanError);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe(error.constructor.name);
    }
  });
});
