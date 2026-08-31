/**
 * Official JavaScript / TypeScript SDK for the NetRiskScan Developer API.
 *
 * @packageDocumentation
 */

export { NetRiskScanClient } from "./client.js";

export {
  NetRiskScanError,
  NetRiskScanConfigurationError,
  NetRiskScanValidationError,
  NetRiskScanAuthenticationError,
  NetRiskScanRateLimitError,
  NetRiskScanApiError,
  NetRiskScanTimeoutError,
  NetRiskScanNetworkError,
} from "./errors/index.js";

export type {
  NetRiskScanErrorOptions,
  NetRiskScanRateLimitErrorOptions,
  NetRiskScanTimeoutErrorOptions,
} from "./errors/index.js";

export { getResponseMeta } from "./http/rate-limit.js";

export { isValidIp } from "./utils/ip.js";

export { VERSION } from "./version.js";

export type {
  ApiErrorBody,
  BatchResult,
  CheckManyOptions,
  FetchLike,
  NetRiskScanClientOptions,
  NetRiskScanErrorCode,
  QuotaInfo,
  RateLimitInfo,
  RequestOptions,
  ResponseMeta,
} from "./types/api.js";

export type {
  AnonymousUsage,
  AssessmentGrade,
  ConnectionType,
  DetectionFlag,
  IpFlags,
  IpNetwork,
  IpRisk,
  IpRiskResult,
  NetworkProfile,
  NetworkType,
  OpenEnum,
  RiskBand,
  UsageMode,
} from "./types/risk.js";

export type { UsagePeriod, UsageRateLimit, UsageResult, UsageUnits } from "./types/usage.js";
