/** Combine optional signals into one that aborts when any of them aborts. */
export function createLinkedAbortSignal(
  signals: Array<AbortSignal | undefined>,
): {
  cleanup: () => void;
  signal: AbortSignal;
} {
  const activeSignals = signals.filter(
    (signal): signal is AbortSignal => signal !== undefined,
  );
  const controller = new AbortController();
  const cleanupFns: Array<() => void> = [];
  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };

  for (const signal of activeSignals) {
    if (signal.aborted) {
      abort();
      break;
    }
    signal.addEventListener("abort", abort, { once: true });
    cleanupFns.push(() => signal.removeEventListener("abort", abort));
  }

  return {
    cleanup: () => {
      for (const cleanup of cleanupFns) {
        cleanup();
      }
    },
    signal: controller.signal,
  };
}
