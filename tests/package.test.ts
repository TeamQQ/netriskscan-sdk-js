import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as sdk from "../src/index.js";
import type { IpLocation, IpRiskResult, RiskReason } from "../src/index.js";

const packageJson = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
) as { version: string; dependencies?: Record<string, string>; private?: boolean };

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
