import { describe, expect, it } from "vitest";
import {
  NetRiskScanClient,
  NetRiskScanConfigurationError,
  NetRiskScanNetworkError,
  NetRiskScanRateLimitError,
  NetRiskScanValidationError,
  getResponseMeta,
} from "../src/index.js";
import {
  ANONYMOUS_IP_RISK_BODY,
  IP_RISK_BODY,
  TEST_API_KEY,
  USAGE_BODY,
  errorBody,
  stubFetch,
} from "./helpers.js";

function client(fetch: ReturnType<typeof stubFetch>["fetch"], options = {}) {
  return new NetRiskScanClient({ apiKey: TEST_API_KEY, fetch, retries: 0, ...options });
}

describe("NetRiskScanClient construction", () => {
  it("allows apiKey to be omitted entirely, for the anonymous tier", () => {
    expect(() => new NetRiskScanClient()).not.toThrow();
    expect(() => new NetRiskScanClient({})).not.toThrow();
  });

  it("rejects a blank (but present) API key before any request is made", () => {
    for (const apiKey of ["", "   "]) {
      expect(() => new NetRiskScanClient({ apiKey })).toThrow(NetRiskScanConfigurationError);
    }
  });

  it("rejects nonsensical numeric options", () => {
    const base = { apiKey: TEST_API_KEY };
    expect(() => new NetRiskScanClient({ ...base, timeoutMs: 0 })).toThrow(
      NetRiskScanConfigurationError,
    );
    expect(() => new NetRiskScanClient({ ...base, timeoutMs: -1 })).toThrow(
      NetRiskScanConfigurationError,
    );
    expect(() => new NetRiskScanClient({ ...base, retries: -1 })).toThrow(
      NetRiskScanConfigurationError,
    );
    expect(() => new NetRiskScanClient({ ...base, maxRetryDelayMs: Number.NaN })).toThrow(
      NetRiskScanConfigurationError,
    );
  });

  it("defaults to the production base URL and trims trailing slashes from an override", () => {
    expect(new NetRiskScanClient({ apiKey: TEST_API_KEY }).baseUrl).toBe(
      "https://api.netriskscan.com",
    );
    expect(
      new NetRiskScanClient({ apiKey: TEST_API_KEY, baseUrl: "https://staging.example.com///" })
        .baseUrl,
    ).toBe("https://staging.example.com");
  });

  it("never exposes the API key as an enumerable property of the client", () => {
    const instance = new NetRiskScanClient({ apiKey: TEST_API_KEY });
    expect(JSON.stringify(instance)).not.toContain(TEST_API_KEY);
    expect(Object.values(instance)).not.toContain(TEST_API_KEY);
  });
});

describe("checkIp", () => {
  it("calls GET /v1/ip-risk/{ip} and returns the API payload unchanged", async () => {
    const stub = stubFetch({ body: IP_RISK_BODY });
    const result = await client(stub.fetch).checkIp("8.8.8.8");

    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]?.url).toBe("https://api.netriskscan.com/v1/ip-risk/8.8.8.8");
    expect(stub.calls[0]?.init?.method).toBe("GET");
    expect(result).toEqual(IP_RISK_BODY);
  });

  it("sends the API key as a Bearer token and asks for JSON", async () => {
    const stub = stubFetch({ body: IP_RISK_BODY });
    await client(stub.fetch).checkIp("8.8.8.8");

    const headers = stub.calls[0]?.headers;
    expect(headers?.get("authorization")).toBe(`Bearer ${TEST_API_KEY}`);
    expect(headers?.get("accept")).toBe("application/json");
    expect(headers?.get("user-agent")).toMatch(/^@netriskscan\/sdk\/\d+\.\d+\.\d+$/);
  });

  it("never puts the API key in the URL", async () => {
    const stub = stubFetch({ body: IP_RISK_BODY });
    await client(stub.fetch).checkIp("8.8.8.8");
    expect(stub.calls[0]?.url).not.toContain(TEST_API_KEY);
  });

  it("sends no query string, which the edge gateway would reject with 400", async () => {
    const stub = stubFetch({ body: IP_RISK_BODY });
    await client(stub.fetch).checkIp("8.8.8.8");
    expect(stub.calls[0]?.url).not.toContain("?");
  });

  it("honours a custom baseUrl", async () => {
    const stub = stubFetch({ body: IP_RISK_BODY });
    await client(stub.fetch, { baseUrl: "https://staging.example.com/" }).checkIp("1.1.1.1");
    expect(stub.calls[0]?.url).toBe("https://staging.example.com/v1/ip-risk/1.1.1.1");
  });

  it("percent-encodes an IPv6 address in the path", async () => {
    const stub = stubFetch({ body: IP_RISK_BODY });
    await client(stub.fetch).checkIp("2001:4860:4860::8888");
    expect(stub.calls[0]?.url).toBe(
      "https://api.netriskscan.com/v1/ip-risk/2001%3A4860%3A4860%3A%3A8888",
    );
  });

  it("rejects an invalid IP locally, without spending a request", async () => {
    const stub = stubFetch({ body: IP_RISK_BODY });
    const instance = client(stub.fetch);

    for (const ip of ["", "abc", "999.999.999.999", "1.2.3", "2001:zzzz::1"]) {
      await expect(instance.checkIp(ip)).rejects.toThrow(NetRiskScanValidationError);
    }
    expect(stub.calls).toHaveLength(0);
  });

  it("tags a local validation failure with the server's invalid_ip code", async () => {
    const stub = stubFetch({ body: IP_RISK_BODY });
    await expect(client(stub.fetch).checkIp("abc")).rejects.toMatchObject({
      name: "NetRiskScanValidationError",
      code: "invalid_ip",
    });
  });

  it("preserves null flags rather than coercing unknown to false", async () => {
    const stub = stubFetch({ body: IP_RISK_BODY });
    const result = await client(stub.fetch).checkIp("8.8.8.8");

    expect(result.flags.scanner).toBeNull();
    expect(result.flags.datacenter).toBe(true);
    expect(result.flags.proxy).toBe(false);
  });

  it("passes through a null index and band for an unscoreable address", async () => {
    const body = {
      requestId: "req_unscoreable0",
      risk: { index: null, band: null, assessmentGrade: "insufficient" },
      network: { type: null, connectionType: null, asn: null, organization: null },
      flags: { proxy: null, vpn: null, tor: null, datacenter: null, scanner: null, abuse: null },
    };
    const stub = stubFetch({ body });
    const result = await client(stub.fetch).checkIp("127.0.0.1");

    expect(result.risk.index).toBeNull();
    expect(result.risk.band).toBeNull();
    expect(result.risk.assessmentGrade).toBe("insufficient");
  });

  it("reports a malformed JSON body as a network error, not a successful parse", async () => {
    const stub = stubFetch({ rawBody: "<html>gateway</html>" });
    await expect(client(stub.fetch).checkIp("8.8.8.8")).rejects.toThrow(NetRiskScanNetworkError);
  });
});

describe("anonymous tier (no apiKey)", () => {
  it("sends no Authorization header at all", async () => {
    const stub = stubFetch({ body: ANONYMOUS_IP_RISK_BODY });
    await new NetRiskScanClient({ fetch: stub.fetch, retries: 0 }).checkIp("8.8.8.8");

    expect(stub.calls[0]?.headers.has("authorization")).toBe(false);
  });

  it("surfaces the server's anonymous usage block on the result", async () => {
    const stub = stubFetch({ body: ANONYMOUS_IP_RISK_BODY });
    const result = await new NetRiskScanClient({ fetch: stub.fetch, retries: 0 }).checkIp(
      "8.8.8.8",
    );

    expect(result.usage).toEqual({
      mode: "anonymous",
      dailyLimit: 30,
      used: 1,
      remaining: 29,
      resetAt: "2026-09-01T00:00:00Z",
    });
  });

  it("does not add a usage block when the server didn't send one", async () => {
    const stub = stubFetch({ body: IP_RISK_BODY });
    const result = await new NetRiskScanClient({ fetch: stub.fetch, retries: 0 }).checkIp(
      "8.8.8.8",
    );

    expect(result.usage).toBeUndefined();
  });

  it("rejects getUsage() locally, without spending a request", async () => {
    const stub = stubFetch({ body: USAGE_BODY });
    await expect(
      new NetRiskScanClient({ fetch: stub.fetch, retries: 0 }).getUsage(),
    ).rejects.toThrow(NetRiskScanValidationError);
    expect(stub.calls).toHaveLength(0);
  });

  it("adds a registration hint to a 429 hit with no apiKey configured", async () => {
    const stub = stubFetch({
      status: 429,
      body: errorBody("rate_limit_exceeded", "API rate limit exceeded."),
      headers: { "retry-after": "60" },
    });
    await expect(
      new NetRiskScanClient({ fetch: stub.fetch, retries: 0 }).checkIp("8.8.8.8"),
    ).rejects.toMatchObject({
      name: "NetRiskScanRateLimitError",
      message: expect.stringContaining("Create a free API key"),
    });
  });

  it("does not add the registration hint when an apiKey is configured", async () => {
    const stub = stubFetch({
      status: 429,
      body: errorBody("quota_exceeded", "Billing-period quota exhausted."),
      headers: { "retry-after": "60" },
    });
    const error = await client(stub.fetch)
      .checkIp("8.8.8.8")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NetRiskScanRateLimitError);
    expect((error as Error).message).not.toContain("Create a free API key");
  });
});

describe("getUsage", () => {
  it("calls GET /v1/usage and returns the payload", async () => {
    const stub = stubFetch({ body: USAGE_BODY });
    const usage = await client(stub.fetch).getUsage();

    expect(stub.calls[0]?.url).toBe("https://api.netriskscan.com/v1/usage");
    expect(usage).toEqual(USAGE_BODY);
    expect(usage.units.remaining).toBe(37550);
    expect(usage.rateLimit.requestsPerMinute).toBe(120);
  });
});

describe("checkMany", () => {
  it("issues one request per address and preserves input order", async () => {
    const stub = stubFetch({ body: IP_RISK_BODY });
    const results = await client(stub.fetch).checkMany(["8.8.8.8", "1.1.1.1", "9.9.9.9"]);

    expect(stub.calls).toHaveLength(3);
    expect(results.map((entry) => entry.ip)).toEqual(["8.8.8.8", "1.1.1.1", "9.9.9.9"]);
    expect(results.every((entry) => entry.ok)).toBe(true);
  });

  it("returns per-address failures without discarding the successes", async () => {
    const stub = stubFetch({ body: IP_RISK_BODY });
    const results = await client(stub.fetch).checkMany(["8.8.8.8", "not-an-ip"]);

    expect(results[0]).toMatchObject({ ip: "8.8.8.8", ok: true });
    expect(results[1]).toMatchObject({ ip: "not-an-ip", ok: false });
    expect(results[1]?.ok === false && results[1].error).toBeInstanceOf(NetRiskScanValidationError);
    // The invalid address never reached the network.
    expect(stub.calls).toHaveLength(1);
  });

  it("never exceeds the configured concurrency", async () => {
    let inFlight = 0;
    let peak = 0;
    const instance = new NetRiskScanClient({
      apiKey: TEST_API_KEY,
      retries: 0,
      fetch: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return new Response(JSON.stringify(IP_RISK_BODY), {
          headers: { "content-type": "application/json" },
        });
      },
    });

    const ips = Array.from({ length: 12 }, (_, i) => `203.0.113.${i + 1}`);
    const results = await instance.checkMany(ips, { concurrency: 3 });

    expect(results).toHaveLength(12);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("rejects a nonsensical concurrency", async () => {
    const stub = stubFetch({ body: IP_RISK_BODY });
    await expect(client(stub.fetch).checkMany(["8.8.8.8"], { concurrency: 0 })).rejects.toThrow(
      NetRiskScanValidationError,
    );
  });

  it("returns an empty array for an empty input", async () => {
    const stub = stubFetch({ body: IP_RISK_BODY });
    await expect(client(stub.fetch).checkMany([])).resolves.toEqual([]);
    expect(stub.calls).toHaveLength(0);
  });
});

describe("custom fetch", () => {
  it("uses the injected implementation instead of the global", async () => {
    const stub = stubFetch({ body: USAGE_BODY });
    await client(stub.fetch).getUsage();
    expect(stub.calls).toHaveLength(1);
  });

  it("fails configuration when no fetch is available at all", () => {
    const original = globalThis.fetch;
    // @ts-expect-error - deliberately removing the global to simulate an ancient runtime.
    delete globalThis.fetch;
    try {
      expect(() => new NetRiskScanClient({ apiKey: TEST_API_KEY })).toThrow(
        NetRiskScanConfigurationError,
      );
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("response metadata", () => {
  it("does not appear in the serialised payload", async () => {
    const stub = stubFetch({
      body: IP_RISK_BODY,
      headers: { "x-ratelimit-limit": "120", "x-request-id": "req_meta00000" },
    });
    const result = await client(stub.fetch).checkIp("8.8.8.8");

    expect(Object.keys(result)).toEqual(["requestId", "risk", "network", "flags"]);
    expect(JSON.parse(JSON.stringify(result))).toEqual(IP_RISK_BODY);
    expect(getResponseMeta(result)?.rateLimit.limit).toBe(120);
  });
});
