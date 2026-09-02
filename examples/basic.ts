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

console.log("  proxy      ", render(result.flags.proxy));
console.log("  proxyType  ", result.flags.proxyType ?? "n/a");
console.log("  vpn        ", render(result.flags.vpn));
console.log("  tor        ", render(result.flags.tor));
console.log("  datacenter ", render(result.flags.datacenter));
console.log("  scanner    ", render(result.flags.scanner));
console.log("  abuse      ", render(result.flags.abuse));
console.log("  searchBot  ", render(result.flags.searchCrawler));
console.log("  crawlerName", result.flags.searchCrawlerName ?? "n/a");

// Network-level GeoIP - not a device's GPS location. `undefined` on older API servers, `null` when
// the address can't be located, an object (with possibly-null fields) otherwise.
console.log("location:   ", result.location?.country ?? "n/a", result.location?.city ?? "");

// Server-generated explanations for the assessment - not a fraud verdict. `undefined` on older API
// servers. Always keep a default case: the reason vocabulary is intentionally extensible.
for (const reason of result.risk.reasons ?? []) {
  console.log("  reason:    ", reason.code, `[${reason.category}/${reason.severity}]`);
}

console.log("requestId:  ", result.requestId);
console.log("quota left: ", getResponseMeta(result)?.quota.remaining ?? "n/a");
