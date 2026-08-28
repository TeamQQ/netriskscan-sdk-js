/**
 * Cancel a request with an AbortController, and tell the three failure modes apart.
 *
 *   NETRISKSCAN_API_KEY=nrs_live_... npx tsx examples/abort.ts
 */
import {
  NetRiskScanClient,
  NetRiskScanNetworkError,
  NetRiskScanTimeoutError,
} from "../src/index.js";

const apiKey = process.env["NETRISKSCAN_API_KEY"];
if (!apiKey) {
  console.error("Set NETRISKSCAN_API_KEY first.");
  process.exit(1);
}

const client = new NetRiskScanClient({ apiKey });

// 1. A caller-initiated abort. The SDK rethrows your own reason untouched, so this is never
//    mistaken for a server failure.
const controller = new AbortController();
setTimeout(() => controller.abort(new Error("user navigated away")), 5);

try {
  await client.checkIp("8.8.8.8", { signal: controller.signal });
  console.log("completed before the abort fired");
} catch (error) {
  if (controller.signal.aborted) {
    console.log("cancelled by caller:", (error as Error).message);
  } else {
    throw error;
  }
}

// 2. The SDK's own per-attempt budget. A separate error class, and never retried.
const impatient = new NetRiskScanClient({ apiKey, timeoutMs: 1 });

try {
  await impatient.checkIp("1.1.1.1");
  console.log("responded within 1ms, which would be remarkable");
} catch (error) {
  if (error instanceof NetRiskScanTimeoutError) {
    console.log(`timed out after ${error.timeoutMs}ms`);
  } else if (error instanceof NetRiskScanNetworkError) {
    console.log("transport failure:", error.message);
  } else {
    throw error;
  }
}

// 3. A signal shared across a batch cancels every request still in flight.
const batchController = new AbortController();
setTimeout(() => batchController.abort(new Error("batch cancelled")), 50);

const results = await client.checkMany(["8.8.8.8", "1.1.1.1", "9.9.9.9"], {
  signal: batchController.signal,
  concurrency: 2,
});

for (const entry of results) {
  console.log(
    entry.ip,
    entry.ok ? `index ${entry.data.risk.index ?? "n/a"}` : "cancelled or failed",
  );
}
