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
 * Six independent detection facts, each three-valued - see {@link DetectionFlag}.
 *
 * None of these is a projection of {@link IpNetwork.type}: in particular
 * `type === "public_infrastructure"` implies nothing about {@link IpFlags.datacenter}, because a public
 * DNS resolver is routinely public infrastructure and not a datacenter.
 */
export interface IpFlags {
  /** Proxy infrastructure detected. */
  proxy: DetectionFlag;
  /** VPN infrastructure detected. */
  vpn: DetectionFlag;
  /** Tor infrastructure detected. */
  tor: DetectionFlag;
  /** Datacenter / hosting infrastructure detected. */
  datacenter: DetectionFlag;
  /**
   * Internet-scanning, crawling, or bot behaviour observed.
   *
   * An address correctly identified as an official crawler is not `true` by that fact alone: identity
   * is {@link IpNetwork.profile}, this is behaviour a source actually observed.
   */
  scanner: DetectionFlag;
  /** Standing abuse reputation - abuse history or blacklist presence. */
  abuse: DetectionFlag;
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
  flags: IpFlags;
}
