# Contributing

Thanks for helping improve the NetRiskScan JavaScript SDK.

## Getting started

```bash
npm install
npm test
```

## Before opening a pull request

All of these must pass — CI runs the same set on Node 20 and 22:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

## Ground rules

- **Never commit a real API key**, test account, or token. Tests use fake keys and a mocked `fetch`,
  and must never reach the live API.
- **No runtime dependencies.** The SDK ships with an empty `dependencies` block, and a test enforces
  it. Development tooling is fine.
- **Do not invent API surface.** Types mirror the server's `/v1` contract. If a field is not in the
  server's DTO, it does not belong in a type. If the server sends a field, do not drop it because an
  example omitted it.
- **Do not reimplement server logic.** No local risk scoring, no re-deriving bands from the index, no
  guessing at internals. The SDK transports and types what the API publishes.
- **Preserve three-valued signals.** `null` means unknown and must never be normalised to `false`.
- **Keep the SDK silent.** No `console` output; `no-console` is enforced by lint.
- **Bump `src/version.ts` alongside `package.json`.** A test keeps the two in step.

## Adding an endpoint

1. Confirm the real contract against the server's controller and DTO — not only the OpenAPI document,
   which can lag behind.
2. Add types under `src/types/`.
3. Add the method to `NetRiskScanClient`, routing through `performRequest`.
4. Cover success, each error status, and retry behaviour in `tests/`.
5. Export any new public type from `src/index.ts`, and update the surface test in
   `tests/package.test.ts`.

Non-idempotent methods must not inherit automatic retries — see `isRetryableMethod`.

## Commit messages

Short imperative subjects (`Add batch helper`, `Fix Retry-After parsing`) are ideal. Conventional
Commit prefixes are welcome but not required.
