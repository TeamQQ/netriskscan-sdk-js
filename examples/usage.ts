/**
 * Read the current plan, billing-period usage, and rate-limit ceiling.
 *
 *   NETRISKSCAN_API_KEY=nrs_live_... npx tsx examples/usage.ts
 */
import { NetRiskScanClient } from "../src/index.js";

const apiKey = process.env["NETRISKSCAN_API_KEY"];
if (!apiKey) {
  console.error("Set NETRISKSCAN_API_KEY first.");
  process.exit(1);
}

const client = new NetRiskScanClient({ apiKey });
const usage = await client.getUsage();

const pct = usage.units.limit > 0 ? Math.round((usage.units.used / usage.units.limit) * 100) : 0;

console.log(`plan:    ${usage.plan}`);
console.log(`period:  ${usage.period.start} -> ${usage.period.end}`);
console.log(`units:   ${usage.units.used} / ${usage.units.limit} used (${pct}%)`);
console.log(`left:    ${usage.units.remaining}`);
console.log(`rate:    ${usage.rateLimit.requestsPerMinute} requests/minute`);
