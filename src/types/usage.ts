/** Response types for `GET /v1/usage`. */

/** The account's current billing period. */
export interface UsagePeriod {
  /** ISO 8601 timestamp. */
  start: string;
  /** ISO 8601 timestamp. */
  end: string;
}

/** Query units consumed in the current billing period. */
export interface UsageUnits {
  /** Units already consumed this period. */
  used: number;
  /** Total units the plan allows per period. */
  limit: number;
  /** Units left this period. */
  remaining: number;
}

/** The plan's request-rate ceiling. */
export interface UsageRateLimit {
  /** Requests allowed per minute on the current plan. */
  requestsPerMinute: number;
}

/** Result of {@link import("../client.js").NetRiskScanClient.getUsage}. */
export interface UsageResult {
  /** Plan code currently in effect, e.g. `growth`. */
  plan: string;
  period: UsagePeriod;
  units: UsageUnits;
  rateLimit: UsageRateLimit;
}
