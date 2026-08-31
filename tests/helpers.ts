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
  risk: { index: 95, band: "excellent", assessmentGrade: "complete" },
  network: {
    type: "public_infrastructure",
    profile: "public_dns_resolver",
    service: "Google Public DNS",
    connectionType: "direct",
    asn: "AS15169",
    organization: "Google LLC",
  },
  flags: { proxy: false, vpn: false, tor: false, datacenter: true, scanner: null, abuse: false },
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
