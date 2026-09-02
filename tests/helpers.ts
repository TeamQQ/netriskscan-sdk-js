import type { FetchLike } from "../src/index.js";

/** A fake API key shaped like a real one. Never a live credential - tests must never hit the network. */
export const TEST_API_KEY = "nrs_live_0000000000000000000000000000test";

export interface StubResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** Sent instead of a JSON body, to exercise malformed-payload handling. */
  rawBody?: string;
}

export interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
  headers: Headers;
}

export interface FetchStub {
  fetch: FetchLike;
  calls: RecordedCall[];
}

function toResponse(stub: StubResponse): Response {
  const headers = new Headers({ "content-type": "application/json", ...stub.headers });
  const body = stub.rawBody ?? (stub.body === undefined ? "" : JSON.stringify(stub.body));
  const status = stub.status ?? 200;
  // 204/205 forbid a body; every status these tests use carries one.
  return new Response(body === "" ? null : body, { status, headers });
}

/** Builds a `fetch` double that answers with `responses` in order, recording every call. */
export function stubFetch(...responses: (StubResponse | (() => StubResponse))[]): FetchStub {
  const calls: RecordedCall[] = [];
  let index = 0;

  const fetch: FetchLike = (url, init) => {
    calls.push({ url, init, headers: new Headers(init?.headers) });
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (next === undefined) throw new Error("stubFetch was called with no configured response");
    return Promise.resolve(toResponse(typeof next === "function" ? next() : next));
  };

  return { fetch, calls };
}

/** Builds a `fetch` double that always rejects, simulating a transport-level failure. */
export function failingFetch(error: Error = new TypeError("fetch failed")): FetchStub {
  const calls: RecordedCall[] = [];
  const fetch: FetchLike = (url, init) => {
    calls.push({ url, init, headers: new Headers(init?.headers) });
    return Promise.reject(error);
  };
  return { fetch, calls };
}

/** A representative `GET /v1/ip-risk/{ip}` payload, matching the server's `PublicIpRiskResponseV1`. */
export const IP_RISK_BODY = {
  requestId: "req_8f3ab21c9dab",
  risk: {
    index: 95,
    band: "excellent",
    assessmentGrade: "complete",
    reasons: [{ code: "PUBLIC_INFRASTRUCTURE", category: "network", severity: "info" }],
  },
  network: {
    type: "public_infrastructure",
    profile: "public_dns_resolver",
    service: "Google Public DNS",
    connectionType: "direct",
    asn: "AS15169",
    organization: "Google LLC",
  },
  location: {
    countryCode: "US",
    country: "United States",
    regionCode: null,
    region: null,
    city: null,
    timeZone: "America/Chicago",
  },
  flags: {
    proxy: false,
    proxyType: null,
    vpn: false,
    tor: false,
    datacenter: true,
    scanner: null,
    abuse: false,
    searchCrawler: false,
    searchCrawlerName: null,
  },
} as const;

/**
 * A pre-P0 `GET /v1/ip-risk/{ip}` payload from a server that does not yet publish `location` or
 * `risk.reasons` - both keys are absent entirely, not `null`.
 */
export const LEGACY_IP_RISK_BODY = {
  requestId: "req_legacy00000",
  risk: { index: 90, band: "excellent", assessmentGrade: "complete" },
  network: {
    type: "public_infrastructure",
    connectionType: "direct",
    asn: "AS15169",
    organization: "Google LLC",
  },
  flags: {
    proxy: false,
    proxyType: null,
    vpn: false,
    tor: false,
    datacenter: false,
    scanner: null,
    abuse: false,
    searchCrawler: false,
    searchCrawlerName: null,
  },
} as const;

/** A representative anonymous-tier `GET /v1/ip-risk/{ip}` payload - `IP_RISK_BODY` plus `usage`. */
export const ANONYMOUS_IP_RISK_BODY = {
  ...IP_RISK_BODY,
  usage: {
    mode: "anonymous",
    dailyLimit: 30,
    used: 1,
    remaining: 29,
    resetAt: "2026-09-01T00:00:00Z",
  },
} as const;

/** A residential proxy payload - `flags.proxy` and `flags.proxyType` populated together. */
export const RESIDENTIAL_PROXY_BODY = {
  requestId: "req_residentialproxy0",
  risk: {
    index: 41,
    band: "poor",
    assessmentGrade: "complete",
    reasons: [{ code: "RESIDENTIAL_PROXY_DETECTED", category: "anonymity", severity: "high" }],
  },
  network: {
    type: "residential",
    connectionType: "residential_proxy",
    asn: "AS64500",
    organization: "Example Residential ISP",
  },
  location: {
    countryCode: "DE",
    country: "Germany",
    regionCode: null,
    region: null,
    city: null,
    timeZone: "Europe/Berlin",
  },
  flags: {
    proxy: true,
    proxyType: "residential_proxy",
    vpn: false,
    tor: false,
    datacenter: false,
    scanner: false,
    abuse: false,
    searchCrawler: false,
    searchCrawlerName: null,
  },
} as const;

/**
 * A verified Googlebot payload - `flags.searchCrawler` / `flags.searchCrawlerName` alongside the
 * independently-reported `network.profile` / `network.service`. Both pairs name "Googlebot" here, but
 * the SDK reports them as received rather than deriving one from the other.
 */
export const GOOGLEBOT_BODY = {
  requestId: "req_googlebot00000",
  risk: {
    index: 88,
    band: "good",
    assessmentGrade: "complete",
    reasons: [
      { code: "VERIFIED_SEARCH_CRAWLER", category: "identity", severity: "info" },
      { code: "PUBLIC_INFRASTRUCTURE", category: "network", severity: "info" },
    ],
  },
  network: {
    type: "public_infrastructure",
    profile: "search_crawler",
    service: "Googlebot",
    connectionType: "direct",
    asn: "AS15169",
    organization: "Google LLC",
  },
  location: {
    countryCode: "US",
    country: "United States",
    regionCode: "CA",
    region: "California",
    city: "Mountain View",
    timeZone: "America/Los_Angeles",
  },
  flags: {
    proxy: false,
    proxyType: null,
    vpn: false,
    tor: false,
    datacenter: true,
    scanner: null,
    abuse: false,
    searchCrawler: true,
    searchCrawlerName: "Googlebot",
  },
} as const;

/** A representative `GET /v1/usage` payload, matching the server's `PublicApiUsageResponseV1`. */
export const USAGE_BODY = {
  plan: "growth",
  period: { start: "2026-08-01T00:00:00+00:00", end: "2026-09-01T00:00:00+00:00" },
  units: { used: 12450, limit: 50000, remaining: 37550 },
  rateLimit: { requestsPerMinute: 120 },
} as const;

/** The API's documented error envelope. */
export function errorBody(code: string, message: string, requestId = "req_error0000") {
  return { error: { code, message, requestId } };
}
