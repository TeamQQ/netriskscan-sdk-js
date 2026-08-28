import { describe, expect, it } from "vitest";
import type { FetchLike } from "../src/index.js";
import { NetRiskScanClient, getResponseMeta } from "../src/index.js";
import { parseQuota, parseRateLimit, parseRetryAfter } from "../src/http/rate-limit.js";
import { IP_RISK_BODY, TEST_API_KEY, USAGE_BODY, stubFetch } from "./helpers.js";

function client(fetch: FetchLike, options: Record<string, unknown> = {}) {
  return new NetRiskScanClient({ apiKey: TEST_API_KEY, fetch, retries: 0, ...options });
}

/** The full header set a successful `/v1/*` response carries. */
const LIVE_HEADERS = {
  "x-request-id": "req_live00000001",
  "x-ratelimit-limit": "120",
  "x-ratelimit-remaining": "118",
  "x-ratelimit-reset": "1793491260",
  "x-quota-limit": "50000",
  "x-quota-used": "12450",
  "x-quota-remaining": "37550",
};

describe("header parsing", () => {
  it("reads the X-RateLimit-* triple", () => {
    expect(parseRateLimit(new Headers(LIVE_HEADERS))).toEqual({
      limit: 120,
      remaining: 118,
      reset: 1793491260,
    });
  });

  it("reads the X-Quota-* triple", () => {
    expect(parseQuota(new Headers(LIVE_HEADERS))).toEqual({
      limit: 50000,
      used: 12450,
      remaining: 37550,
    });
  });

  it("reports absent headers as undefined rather than inventing zeros", () => {
    expect(parseRateLimit(new Headers())).toEqual({
      limit: undefined,
      remaining: undefined,
      reset: undefined,
    });
    expect(parseQuota(new Headers())).toEqual({
      limit: undefined,
      used: undefined,
      remaining: undefined,
    });
  });

  it("ignores unparseable header values", () => {
    const headers = new Headers({ "x-ratelimit-limit": "not-a-number" });
    expect(parseRateLimit(headers).limit).toBeUndefined();
  });

  it("preserves a legitimate zero", () => {
    const headers = new Headers({ "x-ratelimit-remaining": "0", "x-quota-remaining": "0" });
    expect(parseRateLimit(headers).remaining).toBe(0);
    expect(parseQuota(headers).remaining).toBe(0);
  });

  it("reads Retry-After as delta-seconds and ignores the HTTP-date form", () => {
    expect(parseRetryAfter(new Headers({ "retry-after": "60" }))).toBe(60);
    expect(parseRetryAfter(new Headers({ "retry-after": " 30 " }))).toBe(30);
    expect(
      parseRetryAfter(new Headers({ "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" })),
    ).toBeUndefined();
    expect(parseRetryAfter(new Headers())).toBeUndefined();
  });
});

describe("getResponseMeta", () => {
  it("exposes the live snapshot for a successful IP lookup", async () => {
    const stub = stubFetch({ body: IP_RISK_BODY, headers: LIVE_HEADERS });
    const result = await client(stub.fetch).checkIp("8.8.8.8");
    const meta = getResponseMeta(result);

    expect(meta?.status).toBe(200);
    expect(meta?.requestId).toBe("req_live00000001");
    expect(meta?.rateLimit).toEqual({ limit: 120, remaining: 118, reset: 1793491260 });
    expect(meta?.quota).toEqual({ limit: 50000, used: 12450, remaining: 37550 });
  });

  it("works for the usage endpoint too", async () => {
    const stub = stubFetch({ body: USAGE_BODY, headers: LIVE_HEADERS });
    const usage = await client(stub.fetch).getUsage();

    expect(getResponseMeta(usage)?.quota.remaining).toBe(37550);
  });

  it("does not modify the response data in any observable way", async () => {
    const stub = stubFetch({ body: IP_RISK_BODY, headers: LIVE_HEADERS });
    const result = await client(stub.fetch).checkIp("8.8.8.8");

    expect(result).toEqual(IP_RISK_BODY);
    expect(Object.keys(result)).toEqual(Object.keys(IP_RISK_BODY));
    expect(JSON.stringify(result)).toBe(JSON.stringify(IP_RISK_BODY));
    expect({ ...result }).toEqual(IP_RISK_BODY);
  });

  it("returns undefined for values the SDK did not produce", () => {
    expect(getResponseMeta(undefined)).toBeUndefined();
    expect(getResponseMeta(null)).toBeUndefined();
    expect(getResponseMeta("string")).toBeUndefined();
    expect(getResponseMeta({ risk: {} })).toBeUndefined();
  });

  it("returns undefined after a JSON round trip, since the slot is deliberately not serialised", async () => {
    const stub = stubFetch({ body: IP_RISK_BODY, headers: LIVE_HEADERS });
    const result = await client(stub.fetch).checkIp("8.8.8.8");

    expect(getResponseMeta(JSON.parse(JSON.stringify(result)))).toBeUndefined();
  });
});
