/**
 * Look up one IP address.
 *
 *   NETRISKSCAN_API_KEY=nrs_live_... npx tsx examples/basic.ts 8.8.8.8
 */
import { NetRiskScanClient, getResponseMeta } from "../src/index.js";

const apiKey = process.env["NETRISKSCAN_API_KEY"];
if (!apiKey) {
  console.error("Set NETRISKSCAN_API_KEY first.");
  process.exit(1);
}

const client = new NetRiskScanClient({ apiKey });
const result = await client.checkIp(process.argv[2] ?? "8.8.8.8");

// Higher index = cleaner. `null` means the address cannot be scored at all.
console.log("index:      ", result.risk.index ?? "n/a");
console.log("band:       ", result.risk.band ?? "n/a");
console.log("grade:      ", result.risk.assessmentGrade);
console.log("network:    ", result.network.type, `(${result.network.organization ?? "unknown"})`);
console.log("asn:        ", result.network.asn ?? "n/a");

if (result.network.service) {
  console.log("service:    ", `${result.network.service} [${result.network.profile}]`);
}

// Render the three states as three states: `null` is "unknown", never "no".
const render = (flag: boolean | null): string => (flag === null ? "unknown" : flag ? "yes" : "no");
for (const [name, flag] of Object.entries(result.flags) as [string, boolean | null][]) {
  console.log(`  ${name.padEnd(11)}`, render(flag));
}

console.log("requestId:  ", result.requestId);
console.log("quota left: ", getResponseMeta(result)?.quota.remaining ?? "n/a");
