# Changelog

All notable changes to `@netriskscan/sdk` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). While the version is `0.x`, minor
releases may contain breaking changes.

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
