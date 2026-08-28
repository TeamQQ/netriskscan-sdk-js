import { describe, expect, it } from "vitest";
import type { FetchLike } from "../src/index.js";
import { NetRiskScanClient, NetRiskScanError, NetRiskScanTimeoutError } from "../src/index.js";
import { delay, linkAbortSignals } from "../src/utils/abort.js";
import { IP_RISK_BODY, TEST_API_KEY, errorBody, stubFetch } from "./helpers.js";

function client(fetch: FetchLike, options: Record<string, unknown> = {}) {
  return new NetRiskScanClient({ apiKey: TEST_API_KEY, fetch, retries: 0, ...options });
}

/** A fetch double that never settles until its signal aborts. */
const hangingFetch: FetchLike = (_url, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      const reason = init.signal?.reason as unknown;
      reject(
        reason instanceof Error
          ? reason
          : Object.assign(new Error("aborted"), { name: "AbortError" }),
      );
    });
  });

describe("linkAbortSignals", () => {
  it("aborts on its own timeout and reports it as a timeout", async () => {
    const linked = linkAbortSignals(10);
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(linked.signal.aborted).toBe(true);
    expect(linked.timedOut()).toBe(true);
    linked.dispose();
  });

  it("aborts when the caller's signal fires, without claiming a timeout", () => {
    const controller = new AbortController();
    const linked = linkAbortSignals(60_000, controller.signal);

    controller.abort();

    expect(linked.signal.aborted).toBe(true);
    expect(linked.timedOut()).toBe(false);
    linked.dispose();
  });

  it("propagates the caller's own abort reason", () => {
    const controller = new AbortController();
    const reason = new Error("user cancelled");
    const linked = linkAbortSignals(60_000, controller.signal);

    controller.abort(reason);

    expect(linked.signal.reason).toBe(reason);
    linked.dispose();
  });

  it("handles a signal that was already aborted before the call", () => {
    const controller = new AbortController();
    controller.abort();
    const linked = linkAbortSignals(60_000, controller.signal);

    expect(linked.signal.aborted).toBe(true);
    expect(linked.timedOut()).toBe(false);
    linked.dispose();
  });

  it("never aborts the caller's own signal", () => {
    const controller = new AbortController();
    const linked = linkAbortSignals(1, controller.signal);
    linked.dispose();

    expect(controller.signal.aborted).toBe(false);
  });

  it("stops the timeout from firing once disposed", async () => {
    const linked = linkAbortSignals(20);
    linked.dispose();
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(linked.signal.aborted).toBe(false);
    expect(linked.timedOut()).toBe(false);
  });
});

describe("delay", () => {
  it("resolves after the requested time", async () => {
    const started = Date.now();
    await delay(30);
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const controller = new AbortController();
    const reason = new Error("already gone");
    controller.abort(reason);

    await expect(delay(10_000, controller.signal)).rejects.toBe(reason);
  });

  it("rejects as soon as the signal aborts mid-wait", async () => {
    const controller = new AbortController();
    const started = Date.now();
    setTimeout(() => controller.abort(new Error("cancelled")), 20);

    await expect(delay(10_000, controller.signal)).rejects.toThrow("cancelled");
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe("client cancellation", () => {
  it("aborts an in-flight request when the caller's signal fires", async () => {
    const controller = new AbortController();
    const promise = client(hangingFetch, { timeoutMs: 60_000 }).checkIp("8.8.8.8", {
      signal: controller.signal,
    });

    controller.abort();

    await expect(promise).rejects.toThrow();
  });

  it("rethrows the caller's abort reason rather than a NetRiskScan error", async () => {
    const controller = new AbortController();
    const reason = new Error("user pressed cancel");
    const promise = client(hangingFetch, { timeoutMs: 60_000 }).checkIp("8.8.8.8", {
      signal: controller.signal,
    });

    controller.abort(reason);

    const error = await promise.catch((e: unknown) => e);
    expect(error).toBe(reason);
    expect(error).not.toBeInstanceOf(NetRiskScanError);
  });

  it("distinguishes a timeout from a caller abort", async () => {
    const error = await client(hangingFetch, { timeoutMs: 20 })
      .checkIp("8.8.8.8")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NetRiskScanTimeoutError);
  });

  it("does not retry once the caller has aborted during a backoff", async () => {
    const controller = new AbortController();
    const stub = stubFetch({
      status: 503,
      body: errorBody("temporarily_unavailable", "down"),
      headers: { "retry-after": "2" },
    });

    const promise = client(stub.fetch, { retries: 3, maxRetryDelayMs: 30_000 }).checkIp("8.8.8.8", {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(new Error("cancelled")), 30);

    await expect(promise).rejects.toThrow("cancelled");
    expect(stub.calls).toHaveLength(1);
  });

  it("passes a signal through checkMany to every request", async () => {
    const controller = new AbortController();
    const promise = client(hangingFetch, { timeoutMs: 60_000 }).checkMany(["8.8.8.8", "1.1.1.1"], {
      signal: controller.signal,
      concurrency: 2,
    });

    controller.abort(new Error("cancelled"));

    const results = await promise;
    expect(results).toHaveLength(2);
    expect(results.every((entry) => !entry.ok)).toBe(true);
  });

  it("still succeeds when a signal is supplied but never aborted", async () => {
    const controller = new AbortController();
    const stub = stubFetch({ body: IP_RISK_BODY });

    await expect(
      client(stub.fetch).checkIp("8.8.8.8", { signal: controller.signal }),
    ).resolves.toMatchObject({ requestId: IP_RISK_BODY.requestId });
  });
});
