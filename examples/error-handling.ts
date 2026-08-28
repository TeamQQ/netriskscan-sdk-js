/**
 * The full error model, and how to react to each case.
 *
 *   NETRISKSCAN_API_KEY=nrs_live_... npx tsx examples/error-handling.ts 8.8.8.8
 */
import {
  NetRiskScanApiError,
  NetRiskScanAuthenticationError,
  NetRiskScanClient,
  NetRiskScanError,
  NetRiskScanNetworkError,
  NetRiskScanRateLimitError,
  NetRiskScanTimeoutError,
  NetRiskScanValidationError,
} from "../src/index.js";

const apiKey = process.env["NETRISKSCAN_API_KEY"];
if (!apiKey) {
  console.error("Set NETRISKSCAN_API_KEY first.");
  process.exit(1);
}

const client = new NetRiskScanClient({ apiKey });

try {
  const result = await client.checkIp(process.argv[2] ?? "8.8.8.8");
  console.log(`${result.risk.band ?? "unscoreable"} (index ${result.risk.index ?? "n/a"})`);
} catch (error) {
  if (error instanceof NetRiskScanValidationError) {
    // Rejected locally - no request was sent, and no query unit was spent.
    console.error("Not a valid IP address:", error.message);
  } else if (error instanceof NetRiskScanAuthenticationError) {
    // 401 or 403. Retrying cannot fix a rejected credential.
    console.error("Check your API key and its scopes:", error.code);
  } else if (error instanceof NetRiskScanRateLimitError) {
    // `code` separates the per-minute limit from the billing-period quota.
    console.error(
      error.code === "quota_exceeded"
        ? "Billing-period quota exhausted."
        : `Rate limited. Retry in ${error.retryAfter ?? "?"}s.`,
      `(${error.rateLimit.remaining ?? "?"} requests left this window)`,
    );
  } else if (error instanceof NetRiskScanTimeoutError) {
    console.error(`No response within ${error.timeoutMs}ms.`);
  } else if (error instanceof NetRiskScanNetworkError) {
    console.error("Could not reach the API:", error.message);
  } else if (error instanceof NetRiskScanApiError) {
    console.error(`API returned ${error.status ?? "?"} (${error.code ?? "unknown"}).`);
  } else {
    throw error;
  }

  // Every SDK error shares one base class, and carries the trace ID to quote to support.
  if (error instanceof NetRiskScanError && error.requestId) {
    console.error("requestId:", error.requestId);
  }

  process.exitCode = 1;
}
