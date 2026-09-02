# Changelog

All notable changes to `@netriskscan/sdk` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). While the version is `0.x`, minor
releases may contain breaking changes.

## [Unreleased]

### Added

- `IpRiskResult.location` (`IpLocation`) - network-level GeoIP intelligence for the queried address:
  country, region, city, and time zone. Optional and nullable to stay backward-compatible with API
  servers that do not yet publish it - `undefined` means the server hasn't shipped the field,
  `null` means it has nothing to report for this address.
- `IpRisk.reasons` (`RiskReason[]`) - stable, server-generated explanations for the assessment, each
  with a `code`, `category`, and `severity`. Optional for the same backward-compatibility reason as
  `location`.
- `RiskReasonCode`, `RiskReasonCategory`, and `RiskReasonSeverity` - open vocabularies (see
  `OpenEnum`) so a reason code the server introduces after this release still type-checks and renders
  without an SDK upgrade.
- Documentation and examples for `location` and `risk.reasons`, including guidance that a reason is
  descriptive evidence, not a fraud verdict.
- Anonymous access: `apiKey` is now optional on `NetRiskScanClient`. Omitting it uses the Developer
  API's anonymous tier (30 `checkIp()` calls/day per source IP, `ip-risk:read` only) instead of
  throwing `NetRiskScanConfigurationError`.
- `IpRiskResult.usage` (`AnonymousUsage`, `UsageMode`) - the anonymous tier's own daily counter,
  present on `checkIp()` results made with no `apiKey`.
- A `429` hit with no `apiKey` configured now appends a registration hint to
  `NetRiskScanRateLimitError.message`, pointing at the developer console.
- Added `IpFlags.proxyType` with typed support for residential, ISP, mobile, datacenter, and unknown
  proxy classifications.
- Added `IpFlags.searchCrawler` and `IpFlags.searchCrawlerName` for verified search-engine crawler
  identity.
- Exported the new `ProxyType` public type.

### Changed

- `getUsage()` now throws `NetRiskScanValidationError` locally (no request sent) when called with no
  `apiKey` - there is no account to report usage for on the anonymous tier.
- Updated examples and documentation so `IpFlags` is no longer treated as a boolean-only collection.

## [0.1.0] - 2026-08-28

Initial release.

### Added

- `NetRiskScanClient` with `checkIp()`, `getUsage()`, and the client-side `checkMany()` helper.
- Full TypeScript types for the `/v1` contract, with open unions for server-side vocabularies that are
  expected to grow (`band`, `assessmentGrade`, `network.type`, `connectionType`, `profile`).
- Error model: `NetRiskScanError` plus `Configuration`, `Validation`, `Authentication`, `RateLimit`,
  `Api`, `Timeout`, and `Network` subclasses, each carrying `status`, `code`, and `requestId`.
- Per-attempt timeouts composed with a caller-supplied `AbortSignal`, keeping user aborts, timeouts,
  and transport failures distinguishable.
- Bounded automatic retries for `429`/`502`/`503`/`504` and transient transport failures, with
  exponential backoff, jitter, and `Retry-After` support. `GET`/`HEAD` only.
- `getResponseMeta()` for live rate-limit, quota, and request-ID data, exposed without modifying the
  response payload.
- Basic client-side IPv4/IPv6 validation via `isValidIp()`, so obviously invalid input never spends a
  billed round trip.
- Injectable `fetch` for testing and non-Node runtimes.

[0.1.0]: https://github.com/TeamQQ/netriskscan-sdk-js/releases/tag/v0.1.0
