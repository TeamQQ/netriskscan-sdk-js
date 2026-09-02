/**
 * Response types for `GET /v1/ip-risk/{ip}`.
 *
 * Every field here is a direct projection of the server's `PublicIpRiskResponseV1` contract. Nothing is
 * added, renamed, or derived client-side, and no risk scoring happens in this SDK - the NetRiskScan
 * Index and every flag below are computed server-side and published as-is.
 */

/**
 * A value from a server-side vocabulary that is expected to grow.
 *
 * Resolves to the known members for autocomplete and `switch` narrowing, while still accepting any
 * other string the server may introduce - so a new server value is a new value to render, never a type
 * error or a runtime crash. Always handle the unknown case.
 */
export type OpenEnum<T extends string> = T | (string & {});

/**
 * Band of {@link IpRisk.index}, as classified server-side.
 *
 * `90-100` excellent, `75-89` good, `60-74` fair, `40-59` poor, `0-39` high_risk. `unknown` means no
 * index could be produced - it is never a stand-in for `0` or for "clean".
 */
export type RiskBand = OpenEnum<"excellent" | "good" | "fair" | "poor" | "high_risk" | "unknown">;

/** How much evidence backed this assessment. Reported separately from {@link RiskBand}. */
export type AssessmentGrade = OpenEnum<"complete" | "partial" | "limited" | "insufficient">;

/**
 * NetRiskScan's published network classification.
 *
 * `public_infrastructure` outranks the underlying access-network label whenever a public-infrastructure
 * identity (public DNS resolver, CDN edge, crawler, scanner, measurement platform, ...) has been
 * reliably established. `unknown` is a legitimate answer, not an error.
 */
export type NetworkType = OpenEnum<
  | "residential"
  | "mobile"
  | "business_access"
  | "education"
  | "hosting"
  | "datacenter"
  | "public_infrastructure"
  | "unknown"
>;

/** How the address connects. Open vocabulary - render the string, do not hard-code a whitelist. */
export type ConnectionType = OpenEnum<
  "direct" | "vpn" | "proxy" | "residential_proxy" | "tor" | "relay" | "unknown"
>;

/**
 * Server-classified proxy infrastructure subtype, published when {@link IpFlags.proxy} is `true`.
 *
 * Open vocabulary, same as {@link RiskBand} / {@link NetworkType} / {@link ConnectionType} /
 * {@link NetworkProfile} - a new subtype the server introduces still type-checks and renders, rather
 * than becoming a type error against an already-shipped SDK.
 */
export type ProxyType = OpenEnum<
  "residential_proxy" | "isp_proxy" | "mobile_proxy" | "datacenter_proxy" | "unknown_proxy"
>;

/**
 * What the network is *for*. Present only when NetRiskScan holds its own record covering the address.
 *
 * The value set grows as official sources are onboarded, so treat it as an open vocabulary.
 */
export type NetworkProfile = OpenEnum<
  | "public_dns_resolver"
  | "cdn_edge"
  | "search_crawler"
  | "security_scanner"
  | "internet_measurement"
  | "public_service"
  | "enterprise_egress"
  | "shared_cloud_service"
>;

/**
 * A three-valued detection fact.
 *
 * - `true` - detected.
 * - `false` - checked, and came back negative.
 * - `null` - unknown: nothing that could answer the question did, or no source used this round supports
 *   the check at all.
 *
 * `null` is **not** `false`. Collapsing it turns an unanswered question into a finding, so render the
 * three states as three states (`Yes` / `No` / `Unknown`).
 */
export type DetectionFlag = boolean | null;

/**
 * Broad grouping a {@link RiskReason} belongs to, as classified server-side.
 *
 * Open vocabulary, same as {@link RiskBand} / {@link NetworkType} - a new category the server
 * introduces still type-checks and renders.
 */
export type RiskReasonCategory = OpenEnum<
  "network" | "anonymity" | "reputation" | "threat" | "identity" | "quality"
>;

/**
 * How much weight NetRiskScan gives a {@link RiskReason} in its own assessment.
 *
 * `info` covers explanatory, non-adverse reasons (e.g. a verified crawler identity) as much as it
 * covers adverse ones - severity is not a proxy for "this lowered the index".
 */
export type RiskReasonSeverity = OpenEnum<"info" | "low" | "medium" | "high" | "critical">;

/**
 * Identifier for one server-generated explanation, published alongside {@link IpRisk.reasons}.
 *
 * Open vocabulary by design: the server adds new reason codes over time, and an SDK that has not been
 * upgraded yet must still return them unchanged rather than erroring or silently dropping them. Always
 * keep a `default` branch when narrowing on this.
 */
export type RiskReasonCode = OpenEnum<
  | "RESIDENTIAL_PROXY_DETECTED"
  | "ISP_PROXY_DETECTED"
  | "MOBILE_PROXY_DETECTED"
  | "DATACENTER_PROXY_DETECTED"
  | "PROXY_DETECTED"
  | "VPN_DETECTED"
  | "TOR_EXIT_NODE"
  | "TOR_RELAY"
  | "KNOWN_SCANNER"
  | "ABUSE_ACTIVITY"
  | "BLACKLIST_MATCH"
  | "BOTNET_C2"
  | "COMPROMISED_HOST"
  | "SSH_BRUTE_FORCE"
  | "CREDENTIAL_ATTACK"
  | "VERIFIED_SEARCH_CRAWLER"
  | "PUBLIC_INFRASTRUCTURE"
  | "RESIDENTIAL_NETWORK"
  | "CONFLICTING_EVIDENCE"
  | "INSUFFICIENT_EVIDENCE"
>;

/**
 * One server-generated explanation for an {@link IpRisk} assessment.
 *
 * This describes an observed network characteristic or a piece of assessment evidence - it is not a
 * judgment of intent. `VPN_DETECTED` means VPN infrastructure was observed, not that the address is
 * malicious; a `severity: "info"` reason like `VERIFIED_SEARCH_CRAWLER` can be purely explanatory and
 * need not have lowered {@link IpRisk.index} at all.
 */
export interface RiskReason {
  code: RiskReasonCode;
  category: RiskReasonCategory;
  severity: RiskReasonSeverity;
}

/** The one overall score NetRiskScan publishes. */
export interface IpRisk {
  /**
   * The NetRiskScan Index, `0-100`. **Higher means cleaner** - this is not a threat score.
   *
   * `null` when the address cannot be scored at all (loopback, private, reserved ranges, ...), in which
   * case {@link assessmentGrade} is `insufficient`. That is a `200` response, not an error.
   */
  index: number | null;
  /** Band of {@link index}, classified server-side. `null` whenever {@link index} is `null`. */
  band: RiskBand | null;
  /** Evidence completeness behind this assessment. Always present. */
  assessmentGrade: AssessmentGrade;
  /**
   * Server-generated explanations for observed network characteristics and assessment evidence behind
   * this result - not a fraud verdict, and not every entry is adverse (see {@link RiskReason}).
   *
   * **Omitted** by API servers that do not yet publish this field - distinct from `[]`, which means the
   * server supports `reasons` but has nothing to report this time. The SDK never fabricates one state
   * from the other.
   */
  reasons?: RiskReason[];
}

/** Network identity of the queried address. */
export interface IpNetwork {
  /** Published network classification. */
  type: NetworkType | null;
  /**
   * What the network is for - `public_dns_resolver`, `search_crawler`, `cdn_edge`, ...
   *
   * **The key is omitted entirely** (rather than sent as `null`) when NetRiskScan holds no record
   * covering the address, so read it defensively: `undefined` and `null` both mean "no profile".
   */
  profile?: NetworkProfile | null;
  /**
   * The specific service - `Googlebot`, `Google Public DNS`, `Applebot`.
   *
   * Display text, not an identifier: it is the registered source's name and can be reworded, so branch
   * on {@link profile} instead. A value here means the address was found in a range list the operator
   * itself publishes - never that its ASN merely resembled a crawler's. Omitted when there is no match.
   */
  service?: string | null;
  /** How the address connects. */
  connectionType: ConnectionType | null;
  /** Autonomous system number, e.g. `AS15169`. */
  asn: string | null;
  /** Canonical operator of the network / ASN, e.g. `Google LLC`. */
  organization: string | null;
}

/**
 * Published detection and classification fields for the queried address.
 *
 * The detection facts (`proxy`, `vpn`, `tor`, `datacenter`, `scanner`, `abuse`, `searchCrawler`) are
 * each three-valued - see {@link DetectionFlag}. `proxyType` and `searchCrawlerName` are classification
 * metadata: nullable strings published alongside a fact, never a fact themselves.
 *
 * None of these is a projection of {@link IpNetwork.type} or {@link IpNetwork.profile}: in particular
 * `type === "public_infrastructure"` implies nothing about {@link IpFlags.datacenter}, because a public
 * DNS resolver is routinely public infrastructure and not a datacenter. Likewise `searchCrawler` /
 * `searchCrawlerName` and `network.profile` / `network.service` are reported independently even where
 * they overlap (e.g. both naming "Googlebot") - the SDK never derives one from the other.
 */
export interface IpFlags {
  /** Whether proxy infrastructure was detected. */
  proxy: DetectionFlag;
  /**
   * Server-classified proxy infrastructure subtype.
   *
   * Populated only when `proxy === true`. `null` means there is no published proxy subtype - including
   * whenever `proxy` is not `true`. The SDK reports this field exactly as received and never corrects
   * it against `proxy` itself.
   */
  proxyType: ProxyType | null;
  /** VPN infrastructure detected. */
  vpn: DetectionFlag;
  /** Tor infrastructure detected. */
  tor: DetectionFlag;
  /** Datacenter / hosting infrastructure detected. */
  datacenter: DetectionFlag;
  /**
   * Internet-scanning, crawling, or bot behaviour observed.
   *
   * This is behavioural intelligence, not identity - it must not be confused with `searchCrawler`. An
   * address correctly identified as an official crawler is not `true` here by that fact alone: identity
   * is {@link IpNetwork.profile} / `searchCrawler`, this is behaviour a source actually observed. A
   * generic scanner can be `scanner: true, searchCrawler: false` just as easily as a verified crawler
   * can be `scanner: true, searchCrawler: true`.
   */
  scanner: DetectionFlag;
  /** Standing abuse reputation - abuse history or blacklist presence. */
  abuse: DetectionFlag;
  /**
   * Whether the address has been identified by NetRiskScan as verified search-engine crawler
   * infrastructure.
   *
   * This is identity/classification, not generic bot or scanner behaviour - see `scanner` above.
   */
  searchCrawler: DetectionFlag;
  /**
   * Canonical crawler/service name published by NetRiskScan when `searchCrawler === true`, e.g.
   * `"Googlebot"`, `"Bingbot"`, `"Applebot"`.
   *
   * Open string by design - a new crawler identity the server adds later still renders here without
   * requiring an SDK release, so do not narrow this to a closed union.
   */
  searchCrawlerName: string | null;
}

/**
 * Network-level IP geolocation for the queried address, as published by NetRiskScan.
 *
 * This is **GeoIP intelligence derived from the network/ASN**, not a device's GPS or real-time
 * position - two addresses in the same city can resolve to different estimates, and a VPN or proxy
 * will resolve to the exit network's location rather than the end user's. `region` and `city` are
 * frequently `null` even when `country` is known; never treat this as exact physical placement.
 */
export interface IpLocation {
  /** ISO 3166-1 alpha-2 country code, e.g. `"US"`. `null` when unavailable. */
  countryCode: string | null;
  /** Country display name reported by NetRiskScan. */
  country: string | null;
  /** Region/subdivision code when available, e.g. `"CA"`. */
  regionCode: string | null;
  /** Region/subdivision display name, e.g. `"California"`. */
  region: string | null;
  /** Network-level GeoIP city estimate. */
  city: string | null;
  /** IANA time-zone identifier, e.g. `"America/Los_Angeles"`. */
  timeZone: string | null;
}

/** How a request was authenticated. Open vocabulary - render the string, do not hard-code a whitelist. */
export type UsageMode = OpenEnum<"anonymous" | "authenticated">;

/**
 * The anonymous tier's own daily counter, reported on a {@link IpRiskResult} in place of the
 * account-level usage an `apiKey` would otherwise give access to via
 * {@link import("../client.js").NetRiskScanClient.getUsage}.
 *
 * Observed on requests made with no `apiKey` configured; not observed on authenticated ones, which
 * is why {@link IpRiskResult.usage} is optional rather than always present.
 */
export interface AnonymousUsage {
  mode: UsageMode;
  /** `checkIp()` calls the anonymous tier allows per day, per source IP. */
  dailyLimit: number;
  /** Calls already spent today. */
  used: number;
  /** Calls left today. */
  remaining: number;
  /** ISO 8601 timestamp of the next daily reset. */
  resetAt: string;
}

/** Result of {@link import("../client.js").NetRiskScanClient.checkIp}. */
export interface IpRiskResult {
  /**
   * Trace ID for this request, e.g. `req_8f3ab21c9d`.
   *
   * Quote it when reporting a problem to NetRiskScan support.
   */
  requestId: string;
  risk: IpRisk;
  network: IpNetwork;
  /**
   * Network-level IP geolocation. See {@link IpLocation} - not a device's GPS or physical location.
   *
   * - **Omitted (`undefined`)** - this API server does not yet publish `location`.
   * - **`null`** - the server supports `location`, but no estimate is available for this address.
   * - **An object** - location intelligence is available (individual fields may still be `null`).
   *
   * The SDK never collapses these three states into one another.
   */
  location?: IpLocation | null;
  flags: IpFlags;
  /**
   * The anonymous tier's daily counter. Present when this call had no `apiKey`; omitted on an
   * authenticated call, where {@link import("../client.js").NetRiskScanClient.getUsage} is the source
   * of truth for usage instead.
   */
  usage?: AnonymousUsage;
}
