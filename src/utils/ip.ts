/**
 * Basic client-side IP address validation.
 *
 * The point is to avoid spending a billed round trip on input that cannot possibly be an address -
 * `""`, `"abc"`, `"999.999.999.999"`. The server stays the authority on what it accepts; this
 * deliberately does not reimplement its parser, and it never inspects what an address *means*
 * (private, reserved, routable - all of that is the API's job).
 *
 * Implemented without `node:net` so the SDK stays usable in browsers, Workers, and Deno.
 */

/** Matches an IPv4 dotted quad with no leading zeros, mirroring modern `IPAddress.TryParse`. */
const IPV4_OCTET = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)$/;

const IPV6_GROUP = /^[0-9a-fA-F]{1,4}$/;

/** Total 16-bit groups in an IPv6 address. */
const IPV6_GROUP_COUNT = 8;

/** An embedded IPv4 tail (`::ffff:192.0.2.1`) occupies the last two groups. */
const IPV6_GROUPS_PER_IPV4_TAIL = 2;

/** Returns `true` when `value` is a syntactically valid IPv4 address. */
export function isIPv4(value: string): boolean {
  const octets = value.split(".");
  return octets.length === 4 && octets.every((octet) => IPV4_OCTET.test(octet));
}

/**
 * Returns `true` when `value` is a syntactically valid IPv6 address.
 *
 * Accepts `::` compression, an embedded IPv4 tail, and a zone ID (`fe80::1%eth0`), all of which the
 * server's parser accepts.
 */
export function isIPv6(value: string): boolean {
  // A zone ID is scoping information, not part of the address; the server tolerates it, so a non-empty
  // one is stripped before parsing rather than treated as a syntax error.
  const zoneIndex = value.indexOf("%");
  let address = value;
  if (zoneIndex !== -1) {
    if (zoneIndex === value.length - 1) return false;
    address = value.slice(0, zoneIndex);
  }

  const halves = address.split("::");
  if (halves.length > 2) return false;

  // `::` may absorb any number of zero groups, so a compressed address only has to fit, not fill.
  const compressed = halves.length === 2;
  const [headText = "", tailText = ""] = compressed ? halves : [halves[0] ?? "", ""];

  const head = headText === "" ? [] : headText.split(":");
  const tail = tailText === "" ? [] : tailText.split(":");
  if (!compressed && head.length === 0) return false;

  // Only the very last group may be a dotted-quad, and it stands in for two 16-bit groups.
  const groups = [...head, ...tail];
  let width = groups.length;
  const last = groups[groups.length - 1];
  if (last !== undefined && last.includes(".")) {
    if (!isIPv4(last)) return false;
    width += IPV6_GROUPS_PER_IPV4_TAIL - 1;
    groups.pop();
  }

  if (!groups.every((group) => IPV6_GROUP.test(group))) return false;

  return compressed ? width < IPV6_GROUP_COUNT : width === IPV6_GROUP_COUNT;
}

/** Returns `true` when `value` is a syntactically valid IPv4 or IPv6 address. */
export function isValidIp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed === "") return false;
  return trimmed.includes(":") ? isIPv6(trimmed) : isIPv4(trimmed);
}
