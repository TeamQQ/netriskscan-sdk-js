/**
 * Package version, used in the default `User-Agent`.
 *
 * Inlined rather than read from `package.json` at runtime: the SDK must not depend on `fs` or on
 * import attributes, so that it loads unchanged in browsers, Cloudflare Workers, and Deno. A test
 * keeps this in step with `package.json`.
 */
export const VERSION = "0.1.0";
