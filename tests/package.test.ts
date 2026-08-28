import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as sdk from "../src/index.js";

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
