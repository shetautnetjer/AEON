interface ReflectionLaunchCompletion {
  completionSuccess: boolean;
  cleanupUnconfirmed?: boolean;
}

/** Keep existing launch ownership and transcript evidence until work has stopped. */
export async function completeReflectionLaunch<
  T extends ReflectionLaunchCompletion,
>(options: {
  finalize: () => Promise<T>;
  finalizeTranscript: (success: boolean) => Promise<void>;
  notify: (result: T) => void | Promise<void>;
  release: () => void;
}): Promise<void> {
  let retainReservation = false;
  try {
    const result = await options.finalize();
    retainReservation = result.cleanupUnconfirmed === true;
    if (!retainReservation)
      await options.finalizeTranscript(result.completionSuccess);
    await options.notify(result);
  } finally {
    if (!retainReservation) options.release();
  }
}
