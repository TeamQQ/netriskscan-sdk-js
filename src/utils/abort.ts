/**
 * Composes a caller's `AbortSignal` with the SDK's per-attempt timeout.
 *
 * The caller's signal is never replaced or aborted - the two are combined into a third signal, so
 * cancelling ours can never disturb a signal the caller may still be using elsewhere.
 */

/** A composed signal plus the state needed to tell apart *why* it fired. */
export interface LinkedAbort {
  /** Pass this to `fetch`. */
  signal: AbortSignal;
  /** `true` once the SDK's own timeout fired, as opposed to a caller-initiated abort. */
  timedOut: () => boolean;
  /** Clears the timer and detaches listeners. Always call this, in a `finally`. */
  dispose: () => void;
}

/**
 * Builds a signal that aborts when either `timeoutMs` elapses or `userSignal` aborts.
 *
 * A private `AbortController` is used rather than `AbortSignal.any` + `AbortSignal.timeout`, for two
 * reasons: `AbortSignal.any` only landed in Node 20.3, and owning the controller is what lets
 * {@link LinkedAbort.timedOut} distinguish our timeout from the caller's abort without having to
 * inspect the abort reason - which a caller is free to set to anything.
 */
export function linkAbortSignals(timeoutMs: number, userSignal?: AbortSignal): LinkedAbort {
  const controller = new AbortController();
  let timedOut = false;

  const onUserAbort = (): void => {
    // Propagate the caller's own reason so `catch` blocks see the error they threw.
    controller.abort(userSignal?.reason);
  };

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  // Node-only: an outstanding timer must not hold the event loop open on its own.
  (timer as unknown as { unref?: () => void }).unref?.();

  if (userSignal !== undefined) {
    if (userSignal.aborted) {
      onUserAbort();
    } else {
      userSignal.addEventListener("abort", onUserAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      userSignal?.removeEventListener("abort", onUserAbort);
    },
  };
}

/** Rejects after `ms`, or as soon as `signal` aborts - so backoff never outlives a cancelled call. */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(signal.reason as Error);
      return;
    }

    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason as Error);
    };

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
