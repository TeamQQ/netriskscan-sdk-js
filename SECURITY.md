# Security Policy

## Supported versions

The latest `0.x` release receives security fixes.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for a security problem.

Report it privately through
[GitHub Security Advisories](https://github.com/TeamQQ/netriskscan-sdk-js/security/advisories/new),
or email <security@netriskscan.com>. Include reproduction steps and the affected version. You can
expect an acknowledgement within a few business days.

## Handling API keys

NetRiskScan API keys are bearer credentials: whoever holds one can spend your quota.

- **Never ship a key to a browser.** It is readable in the bundle and in the network tab. Call the
  Developer API from a backend, serverless function, or Worker, and pass only results to your frontend.
- Keep keys in a secret manager or environment variable — never in source control.
- A key is shown in full exactly once at creation. The server stores only a prefix, the last four
  characters, and a hash, so a lost key can only be revoked and replaced.
- Rotate immediately on suspected exposure; revoke from the developer console.

This SDK never places the key in a URL, and never includes it in an error message, stack trace, or log
output. It writes nothing to `console` at all.

## Reporting an API problem

For a vulnerability in the NetRiskScan API itself rather than this client library, use the same
private channels above.
