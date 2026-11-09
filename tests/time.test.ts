import assert from "node:assert/strict";
import test from "node:test";
import { addDays, johannesburgDate, reportWindow, startOfJohannesburgDayMs } from "../lib/time";

test("Johannesburg dates cross midnight two hours ahead of UTC", () => {
  assert.equal(johannesburgDate("2026-11-04T22:30:00Z"), "2026-11-05");
  assert.equal(johannesburgDate("2026-11-04T21:30:00Z"), "2026-11-04");
});

test("midnight in Johannesburg is 22:00 UTC the previous day", () => {
  assert.equal(new Date(startOfJohannesburgDayMs("2026-11-05")).toISOString(), "2026-11-04T22:00:00.000Z");
});

test("addDays stays on the calendar", () => {
  assert.equal(addDays("2026-11-08", -6), "2026-11-02");
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
});

test("a morning anchor leaves that day out of the average", () => {
  const window = reportWindow("2026-11-09T06:59:53Z", 7);
  assert.equal(window.end, "2026-11-08");
  assert.equal(window.start, "2026-11-02");
  assert.equal(window.partialDate, "2026-11-09");
});
