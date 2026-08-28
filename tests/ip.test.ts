import { describe, expect, it } from "vitest";
import { isValidIp } from "../src/index.js";

describe("isValidIp", () => {
  it.each(["8.8.8.8", "1.1.1.1", "0.0.0.0", "255.255.255.255", "192.168.1.1", "203.0.113.44"])(
    "accepts the IPv4 address %s",
    (ip) => {
      expect(isValidIp(ip)).toBe(true);
    },
  );

  it.each([
    "2001:4860:4860::8888",
    "::1",
    "::",
    "fe80::1",
    "2001:db8:0:0:0:0:0:1",
    "2001:0db8:85a3:0000:0000:8a2e:0370:7334",
    "::ffff:192.0.2.1",
    "64:ff9b::192.0.2.33",
    "fe80::1%eth0",
  ])("accepts the IPv6 address %s", (ip) => {
    expect(isValidIp(ip)).toBe(true);
  });

  it.each([
    ["an empty string", ""],
    ["whitespace only", "   "],
    ["a word", "abc"],
    ["out-of-range octets", "999.999.999.999"],
    ["a single out-of-range octet", "1.2.3.256"],
    ["too few octets", "1.2.3"],
    ["too many octets", "1.2.3.4.5"],
    ["leading zeros", "01.2.3.4"],
    ["an empty octet", "1..3.4"],
    ["a trailing dot", "1.2.3.4."],
    ["a CIDR suffix", "8.8.8.8/32"],
    ["a port", "8.8.8.8:80"],
  ])("rejects IPv4 input with %s", (_label, ip) => {
    expect(isValidIp(ip)).toBe(false);
  });

  it.each([
    ["too many groups", "1:2:3:4:5:6:7:8:9"],
    ["too few groups uncompressed", "1:2:3:4:5:6:7"],
    ["a double compression", "1::2::3"],
    ["a non-hex group", "2001:zzzz::1"],
    ["an over-long group", "2001:12345::1"],
    ["a triple colon", ":::"],
    ["an empty zone id", "fe80::1%"],
    ["a bad embedded IPv4", "::ffff:999.0.2.1"],
    ["a full address plus compression overflow", "1:2:3:4:5:6:7::8"],
  ])("rejects IPv6 input with %s", (_label, ip) => {
    expect(isValidIp(ip)).toBe(false);
  });

  it("rejects non-string input", () => {
    expect(isValidIp(undefined)).toBe(false);
    expect(isValidIp(null)).toBe(false);
    expect(isValidIp(8888)).toBe(false);
    expect(isValidIp(["8.8.8.8"])).toBe(false);
  });

  it("tolerates surrounding whitespace, as the server does", () => {
    expect(isValidIp("  8.8.8.8  ")).toBe(true);
  });
});
