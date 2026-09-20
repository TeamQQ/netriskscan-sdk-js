import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as sdk from "../src/index.js";
import type { IpLocation, IpRiskResult, RiskReason } from "../src/index.js";

const packageJson = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
) as {
  version: string;
  homepage?: string;
  dependencies?: Record<string, string>;
  private?: boolean;
};

describe("package integrity", () => {
  it("keeps the inlined VERSION in step with package.json", () => {
    expect(sdk.VERSION).toBe(packageJson.version);
  });

  it("ships with no runtime dependencies", () => {
    expect(packageJson.dependencies ?? {}).toEqual({});
  });

  it("is publishable", () => {
    expect(packageJson.private).not.toBe(true);
  });

  it("points package users to the official website", () => {
    const homepage = new URL(packageJson.homepage ?? "");

    expect(homepage.origin).toBe("https://www.netriskscan.com");
    expect(homepage.pathname).toBe("/");
  });

  // npm's package page evidently sends no usable Referer when its "Homepage" link is followed, so the UTM tags are the ONLY
  // way NetRiskScan can tell this traffic came from npm. Without them the visit is recorded as "direct".
  it("tags the npm homepage link so the visit is attributed to npm", () => {
    const { searchParams } = new URL(packageJson.homepage ?? "");

    expect(Object.fromEntries(searchParams)).toEqual({
      utm_source: "npm",
      utm_medium: "referral",
      utm_campaign: "sdk-js",
      utm_content: "package-homepage",
    });
  });
});

describe("README website links", () => {
  const readme = readFileSync(fileURLToPath(new URL("../README.md", import.meta.url)), "utf8");
  // Links to the website itself. api.netriskscan.com is the API host, not a page a visitor lands on.
  const websiteLinks = [
    ...readme.matchAll(/\]\((https:\/\/(?:www\.)?netriskscan\.com[^)]*)\)/g),
  ].map((match) => match[1]!);

  it("has at least one link to the website", () => {
    expect(websiteLinks.length).toBeGreaterThan(0);
  });

  // Kept apart from the npm homepage's tags: the README is what GitHub visitors read, and mixing the two
  // would make the two channels impossible to tell apart in NetRiskScan's traffic analytics.
  it("tags every website link as GitHub README traffic, distinct from the npm homepage", () => {
    for (const link of websiteLinks) {
      expect(Object.fromEntries(new URL(link).searchParams)).toEqual({
        utm_source: "github",
        utm_medium: "referral",
        utm_campaign: "sdk-js",
        utm_content: "readme",
      });
    }
    expect(websiteLinks).not.toContain(packageJson.homepage);
  });
});

describe("public API surface", () => {
  it("exports exactly the intended runtime values", () => {
    expect(Object.keys(sdk).sort()).toEqual([
      "NetRiskScanApiError",
      "NetRiskScanAuthenticationError",
      "NetRiskScanClient",
      "NetRiskScanConfigurationError",
      "NetRiskScanError",
      "NetRiskScanNetworkError",
      "NetRiskScanRateLimitError",
      "NetRiskScanTimeoutError",
      "NetRiskScanValidationError",
      "VERSION",
      "getResponseMeta",
      "isValidIp",
    ]);
  });

  it("exposes the client methods the CLI will depend on", () => {
    const methods = Object.getOwnPropertyNames(sdk.NetRiskScanClient.prototype);
    expect(methods).toContain("checkIp");
    expect(methods).toContain("getUsage");
    expect(methods).toContain("checkMany");
  });
});

describe("P0 public types", () => {
  // Type-only import above proves `IpLocation` / `IpRiskResult` / `RiskReason` are reachable from the
  // package root (`../src/index.js`, not a `dist/...` subpath) - a regression here fails
  // `npm run typecheck`, since these annotations don't exist at runtime.
  it("wires location and an unrecognised future reason code into IpRiskResult", () => {
    const location: IpLocation = {
      countryCode: "US",
      country: "United States",
      regionCode: null,
      region: null,
      city: null,
      timeZone: "America/Chicago",
    };
    const reasons: RiskReason[] = [
      // A code/category/severity the SDK has never seen still satisfies the open-vocabulary types.
      { code: "FUTURE_NETWORK_SIGNAL", category: "future_category", severity: "future_severity" },
    ];
    const result: IpRiskResult = {
      requestId: "req_types0000",
      risk: { index: 50, band: "fair", assessmentGrade: "complete", reasons },
      network: { type: null, connectionType: null, asn: null, organization: null },
      location,
      flags: {
        proxy: null,
        proxyType: null,
        vpn: null,
        tor: null,
        datacenter: null,
        scanner: null,
        abuse: null,
        searchCrawler: null,
        searchCrawlerName: null,
      },
    };

    expect(result.location?.country).toBe("United States");
    expect(result.risk.reasons?.[0]?.code).toBe("FUTURE_NETWORK_SIGNAL");
  });
});
