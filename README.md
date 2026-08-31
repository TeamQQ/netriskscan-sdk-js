# NetRiskScan SDK for JavaScript

**IP risk & network intelligence — the official JavaScript / TypeScript SDK.**

[![CI](https://github.com/TeamQQ/netriskscan-sdk-js/actions/workflows/ci.yml/badge.svg)](https://github.com/TeamQQ/netriskscan-sdk-js/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@netriskscan/sdk.svg)](https://www.npmjs.com/package/@netriskscan/sdk)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Ask the [NetRiskScan Developer API](https://api.netriskscan.com) what it knows about an IP address:
a 0–100 cleanliness score, what kind of network it is, who operates it, and whether proxy, VPN, Tor,
datacenter, scanner, or abuse signals were detected.

```ts
const result = await client.checkIp("8.8.8.8");
// → index 95, band "excellent", public_infrastructure, Google LLC
```

Typed end to end, zero runtime dependencies, built on `fetch`.

---

## Features

- **Two endpoints, fully typed** — `checkIp()` and `getUsage()`, matching the `/v1` contract exactly.
- **Zero runtime dependencies** — nothing but the platform's own `fetch`.
- **A real error model** — eight classes under one base, so you can branch on what actually went wrong.
- **Timeouts and cancellation** — per-request `timeoutMs`, plus your own `AbortSignal`, composed rather
  than one overriding the other.
- **Bounded automatic retries** — `429`/`502`/`503`/`504` only, exponential backoff with jitter,
  honouring `Retry-After`.
- **Live rate-limit and quota visibility** — parsed from every response, without touching the payload.
- **Three-valued signals preserved** — `null` means _unknown_, and never silently becomes `false`.
- **ESM-first, runs anywhere `fetch` does** — Node.js 20+, Bun, Deno, Cloudflare Workers.

## Installation

```bash
npm install @netriskscan/sdk
```

Requires **Node.js 20 or newer** (for the global `fetch`), or any runtime that provides `fetch`.

## Quick Start

```ts
import { NetRiskScanClient } from "@netriskscan/sdk";

const client = new NetRiskScanClient({
  apiKey: process.env.NETRISKSCAN_API_KEY!,
});

const result = await client.checkIp("8.8.8.8");

console.log(result.risk.index); // 95      — higher is cleaner
console.log(result.risk.band); //  "excellent"
```

## Authentication

Create an API key in the [NetRiskScan developer console](https://netriskscan.com). Keys look like
`nrs_live_…`, and are shown **in full exactly once** — store yours immediately, because the server
keeps only a hash and cannot recover it for you.

```ts
const client = new NetRiskScanClient({ apiKey: "nrs_live_…" });
```

The SDK sends it as `Authorization: Bearer <key>`. It never puts the key in a URL, and never includes
it in an error message, stack trace, or log line.

**The SDK does not read `process.env` for you.** Pass the key in explicitly. That keeps the client free
of any Node-only assumption, so the same code runs in a Worker or a browser build.

Each key carries scopes: `ip-risk:read` for `checkIp()`, `usage:read` for `getUsage()`. A key missing
the scope gets a `403`, surfaced as `NetRiskScanAuthenticationError`.

### Anonymous access (no API key)

`apiKey` is optional. Omit it entirely and `checkIp()` still works, on an anonymous tier capped at
**30 requests/day per source IP**:

```ts
const client = new NetRiskScanClient({}); // no apiKey

const result = await client.checkIp("8.8.8.8");
console.log(result.usage); // { mode: "anonymous", dailyLimit: 30, used: 1, remaining: 29, resetAt: "…" }
```

Good for a quick trial or a CLI default; not a substitute for a key in anything you ship; `getUsage()`
always needs one, since there is no account to report usage for. Calling it anonymously throws
`NetRiskScanValidationError` locally, before any request is sent - read the `usage` field on
`checkIp()`'s result instead, or `getResponseMeta()`'s `rateLimit`, which the API populates from the
same `X-RateLimit-*` headers either way.

Once the daily limit is hit, `checkIp()` throws `NetRiskScanRateLimitError` same as an authenticated
`429` would, with a reminder appended to `error.message` pointing at the developer console.

## Check an IP

```ts
const result = await client.checkIp("8.8.8.8");
```

```jsonc
{
  "requestId": "req_8f3ab21c9dab",
  "risk": {
    "index": 95, // 0–100, higher = cleaner. null when unscoreable.
    "band": "excellent", // excellent | good | fair | poor | high_risk | unknown
    "assessmentGrade": "complete", // complete | partial | limited | insufficient
  },
  "network": {
    "type": "public_infrastructure",
    "profile": "public_dns_resolver", // only when NetRiskScan holds its own record
    "service": "Google Public DNS", // ditto — display text, not an identifier
    "connectionType": "direct",
    "asn": "AS15169",
    "organization": "Google LLC",
  },
  "flags": {
    "proxy": false,
    "vpn": false,
    "tor": false,
    "datacenter": true,
    "scanner": null,
    "abuse": false,
  },
}
```

### The index is a cleanliness score, not a threat score

**Higher is better.** `95` is an excellent network environment; `12` is a bad one. The band is
classified server-side — read `risk.band` rather than re-deriving thresholds locally, so your UI can
never disagree with the API.

### `null` is not `false`

Every entry in `flags` is three-valued:

| Value   | Meaning                                                                       |
| ------- | ----------------------------------------------------------------------------- |
| `true`  | Detected.                                                                     |
| `false` | Checked, and came back negative.                                              |
| `null`  | **Unknown** — nothing that could answer did, or no source supports the check. |

Render three states as three states. Collapsing `null` into "No" turns an unanswered question into a
finding:

```ts
const label = (flag: boolean | null) => (flag === null ? "Unknown" : flag ? "Yes" : "No");
```

`network.type === "public_infrastructure"` implies **nothing** about `flags.datacenter` — a public DNS
resolver is routinely public infrastructure and not a datacenter.

### An unscoreable address is a success, not an error

Loopback, private, and reserved addresses return `200` with `risk.index === null`,
`risk.band === null`, and `risk.assessmentGrade === "insufficient"`. The API declines to invent a
score rather than reporting a fake one. Only a string that is not an IP at all produces `400`.

```ts
const result = await client.checkIp("127.0.0.1");
if (result.risk.index === null) {
  console.log("not scoreable:", result.risk.assessmentGrade); // "insufficient"
}
```

### Open vocabularies

`band`, `assessmentGrade`, `network.type`, `network.connectionType`, and `network.profile` are typed as
open unions: known values autocomplete and narrow, and a value the server adds later still type-checks
and renders instead of crashing. Handle the unknown case, and never hard-code an exhaustive whitelist.

### Several addresses at once

```ts
const results = await client.checkMany(["8.8.8.8", "1.1.1.1"], { concurrency: 5 });

for (const entry of results) {
  if (entry.ok) console.log(entry.ip, entry.data.risk.band);
  else console.error(entry.ip, entry.error);
}
```

> **This is a client-side loop, not a batch endpoint.** It issues one `GET /v1/ip-risk/{ip}` per
> address and spends **one query unit per address**. The Developer API has no batch route today.
> Keep `concurrency` at or below your plan's ceiling.

Results come back in input order, and one failure never discards the addresses that succeeded.

## Usage / Quota

```ts
const usage = await client.getUsage();

console.log(usage.plan); // "growth"
console.log(usage.units.used, usage.units.limit, usage.units.remaining);
console.log(usage.period.start, usage.period.end);
console.log(usage.rateLimit.requestsPerMinute);
```

`getUsage()` consumes no query units. `checkIp()` consumes exactly one per call — **cache hits
included**.

## Error Handling

Every error extends `NetRiskScanError`, so one `catch` separates SDK failures from bugs in your code.

```
NetRiskScanError
├── NetRiskScanConfigurationError   bad client options — thrown before any request
├── NetRiskScanValidationError      bad argument — no request sent, no unit spent
├── NetRiskScanAuthenticationError  401 / 403
├── NetRiskScanRateLimitError       429 — rate limit or quota
├── NetRiskScanApiError             any other non-2xx
├── NetRiskScanTimeoutError         timeoutMs elapsed
└── NetRiskScanNetworkError         never reached the server
```

Each carries `status`, `code`, and `requestId` where the API supplied them.

```ts
import {
  NetRiskScanClient,
  NetRiskScanRateLimitError,
  NetRiskScanAuthenticationError,
  NetRiskScanError,
} from "@netriskscan/sdk";

try {
  const result = await client.checkIp("8.8.8.8");
  console.log(result.risk.index, result.risk.band);
} catch (error) {
  if (error instanceof NetRiskScanRateLimitError) {
    console.error(`Rate limited — retry in ${error.retryAfter ?? "?"}s`);
  } else if (error instanceof NetRiskScanAuthenticationError) {
    console.error("Check your API key and its scopes:", error.code);
  } else if (error instanceof NetRiskScanError) {
    console.error(`${error.status ?? "?"} ${error.code ?? ""} — quote ${error.requestId}`);
  }
  throw error;
}
```

**Always keep `requestId`.** Quoting it in a support request is what lets NetRiskScan trace your exact
call.

### Error codes

| Status | `code`                    | Meaning                                                        |
| ------ | ------------------------- | -------------------------------------------------------------- |
| 400    | `invalid_ip`              | Not a valid IPv4 / IPv6 address                                |
| 400    | `invalid_request`         | Unsupported query parameter, or body too large                 |
| 400    | `unsupported_parameter`   | Cache-refresh parameters are not supported                     |
| 401    | `invalid_api_key`         | Missing, malformed, or unknown key                             |
| 403    | `api_key_disabled`        | Key disabled, revoked, or expired; or account/plan unavailable |
| 403    | `scope_not_allowed`       | Key lacks the scope this endpoint needs                        |
| 404    | `not_found`               | No such path                                                   |
| 404    | `feature_not_available`   | Capability not open yet (e.g. batch)                           |
| 429    | `rate_limit_exceeded`     | Per-minute request limit hit                                   |
| 429    | `quota_exceeded`          | Billing-period quota exhausted                                 |
| 503    | `temporarily_unavailable` | Transient server-side or upstream failure                      |

## Rate Limits

Every `/v1/*` response carries a live snapshot in its headers. Read it with `getResponseMeta()`, which
returns metadata **without modifying the response payload** — the object you get from `checkIp()`
still serialises byte-for-byte as the API sent it.

```ts
import { getResponseMeta } from "@netriskscan/sdk";

const result = await client.checkIp("8.8.8.8");
const meta = getResponseMeta(result);

meta?.rateLimit; // { limit: 120, remaining: 118, reset: 1793491260 }
meta?.quota; // { limit: 50000, used: 12450, remaining: 37550 }
meta?.requestId; // "req_8f3ab21c9dab"
```

Parsed from `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `X-Quota-Limit`,
`X-Quota-Used`, `X-Quota-Remaining`, and `X-Request-Id`. A field is `undefined` when the server did not
send that header — never a fabricated `0`.

Watch `remaining` and slow down before you hit `429`, rather than waiting to be rejected.

### Automatic retries

Retried: **`429`, `502`, `503`, `504`**, and transient transport failures.
Never retried: **`400`, `401`, `403`, `404`, `409`, `422`** — repeating them cannot help.

Backoff is exponential with jitter (≈250 ms, 500 ms, 1000 ms), and a server-sent `Retry-After` always
wins over the SDK's own schedule.

```ts
new NetRiskScanClient({
  apiKey,
  retries: 2, // extra attempts after the first (default 2)
  maxRetryDelayMs: 10_000, // longest single backoff to sleep through (default 10s)
});
```

If `Retry-After` exceeds `maxRetryDelayMs`, the SDK **stops rather than blocking** and throws
`NetRiskScanRateLimitError` with `retryAfter` set, so scheduling a long wait stays your decision.

Only `GET` and `HEAD` are ever retried automatically, so a future non-idempotent endpoint cannot
inherit retries and double-charge your quota.

> The SDK respects rate limits. It does not rotate keys, fan out across credentials, or work around
> quotas, and it never will.

## Timeouts

`timeoutMs` (default `10000`) applies **per attempt**, covering the response body as well as the
headers.

```ts
const client = new NetRiskScanClient({ apiKey, timeoutMs: 5_000 });
```

Timeouts are not retried, so your worst case stays bounded rather than multiplying by the retry count.
An elapsed budget throws `NetRiskScanTimeoutError`, which is distinct from both a network failure and
your own cancellation.

## Abort Requests

Pass your own `AbortSignal`. It is composed with the SDK's timeout, never replaced — and the SDK never
aborts a signal you own.

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 2_000);

const result = await client.checkIp("1.1.1.1", { signal: controller.signal });
```

When you abort, **your own reason is rethrown untouched** — it is never relabelled as a NetRiskScan
server failure. That keeps the three failure modes cleanly apart:

| Cause               | What you catch                                 |
| ------------------- | ---------------------------------------------- |
| You aborted         | Your abort reason (an `AbortError` by default) |
| `timeoutMs` elapsed | `NetRiskScanTimeoutError`                      |
| Connection failed   | `NetRiskScanNetworkError`                      |

A signal passed to `checkMany()` cancels every request still in flight.

## TypeScript

Types are generated from the source and ship with the package — no `@types/*` needed.

```ts
import type {
  IpRiskResult,
  UsageResult,
  RiskBand,
  AssessmentGrade,
  NetworkType,
  ConnectionType,
  DetectionFlag,
  ResponseMeta,
} from "@netriskscan/sdk";
```

Built under `strict`, plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. The public
surface contains no `any`.

Note that `network.profile` and `network.service` are **optional** — the server omits the keys
entirely rather than sending `null` when it holds no record — so read them defensively.

## Examples

Runnable scripts in [`examples/`](./examples):

| File                                                | Shows                                          |
| --------------------------------------------------- | ---------------------------------------------- |
| [`basic.ts`](./examples/basic.ts)                   | Look up one address and render every field     |
| [`usage.ts`](./examples/usage.ts)                   | Plan, quota, and rate-limit ceiling            |
| [`abort.ts`](./examples/abort.ts)                   | Cancellation, timeouts, and telling them apart |
| [`error-handling.ts`](./examples/error-handling.ts) | Every error class, and how to react            |

```bash
NETRISKSCAN_API_KEY=nrs_live_… npx tsx examples/basic.ts 8.8.8.8
```

## Supported Runtimes

| Runtime            | Status                                        |
| ------------------ | --------------------------------------------- |
| Node.js 20+        | Primary target, tested in CI on 20 and 22     |
| Bun / Deno         | Supported — built on standard `fetch`         |
| Cloudflare Workers | Supported                                     |
| Browsers           | Technically works, but see **Security** first |

The package imports nothing from `node:*`, touches no filesystem, and reads no environment variable.

Need a different transport? Inject one:

```ts
new NetRiskScanClient({ apiKey, fetch: myInstrumentedFetch });
```

## Security

> **Do not expose API keys in browser-side public code.**

A key shipped to a browser is a key you have given away — anyone can read it out of your bundle or
network tab, and spend your quota. This applies equally to React, Vue, Svelte, and Next.js **client**
components.

Call the Developer API from somewhere you control instead:

- a backend service or API route
- a serverless function
- a Cloudflare Worker
- a Next.js **server** component or route handler

then pass only the result to your frontend.

The API also sends no CORS headers, so a browser cannot call it cross-origin regardless — server-side
usage is the supported path, not merely the recommended one.

Other guarantees:

- The API key never appears in a URL, error message, stack trace, or log.
- The SDK is **silent by default** — it never writes to `console`, and `no-console` is enforced by lint.
- No results are cached. Risk data changes, and the SDK will not decide a caching policy for you; add
  one in your own layer if you need it, with a TTL you have chosen deliberately.

To report a vulnerability, see [SECURITY.md](./SECURITY.md).

## API Documentation

- Base URL: `https://api.netriskscan.com`
- `GET /v1/ip-risk/{ip}` — scope `ip-risk:read`, 1 query unit
- `GET /v1/usage` — scope `usage:read`, free

This SDK talks only to the public `/v1` Developer API. Risk scoring happens server-side; the SDK
transports and types the published result, and computes nothing locally.

## CLI

Prefer the terminal? [`netriskscan-cli`](https://github.com/TeamQQ/netriskscan-cli) wraps the same API.

```bash
npx netriskscan check 8.8.8.8
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Tests run entirely against a mocked `fetch` and fake keys —
never against the live API.

```bash
npm install
npm run lint && npm run typecheck && npm test && npm run build
```

## License

[MIT](./LICENSE) © NetRiskScan
