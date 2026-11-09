import assert from "node:assert/strict";
import test from "node:test";
import { retryTimeouts, timeoutMessage } from "../lib/siu-retry";

test("a timeout is retried twice and then succeeds", async () => {
  let calls = 0;
  const result = await retryTimeouts(async () => {
    calls += 1;
    if (calls < 3) {
      const error = new Error("slow");
      error.name = "TimeoutError";
      throw error;
    }
    return "ok";
  }, async () => {});
  assert.equal(result, "ok");
  assert.equal(calls, 3);
});

test("a timeout that keeps failing reports timeout", async () => {
  await assert.rejects(
    () =>
      retryTimeouts(async () => {
        const error = new Error("slow");
        error.name = "TimeoutError";
        throw error;
      }, async () => {}),
    (error: unknown) => error instanceof Error && error.name === "TimeoutError",
  );
  assert.match(timeoutMessage(), /timeout/);
});

test("a non-timeout error is not retried", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      retryTimeouts(async () => {
        calls += 1;
        throw new Error("nope");
      }, async () => {}),
  );
  assert.equal(calls, 1);
});
