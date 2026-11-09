export function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String((error as { name: unknown }).name) : "";
  return name === "TimeoutError" || name === "AbortError";
}

export function timeoutMessage(): string {
  return "StockItUp timeout. De aanvraag duurde te lang.";
}

/** Try once, then retry a timeout `retries` times (default 2), with a short pause between tries. */
export async function retryTimeouts<T>(
  run: () => Promise<T>,
  wait: (ms: number) => Promise<void> = delay,
  retries = 2,
): Promise<T> {
  const attempts = Math.max(1, retries + 1);
  let last: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      last = error;
      if (!isTimeoutError(error) || attempt === attempts - 1) break;
      await wait(attempt === 0 ? 300 : 900);
    }
  }
  throw last;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
