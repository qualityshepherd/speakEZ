export const calcBackoffDelay = (attempts, maxMs = 30000) =>
  Math.min(maxMs, 1000 * 2 ** attempts)
