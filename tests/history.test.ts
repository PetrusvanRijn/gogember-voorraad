import assert from "node:assert/strict";
import test from "node:test";
import { emptyHistory, knownDates } from "../lib/history";
import {
  collectDailyUsage,
  mergeClosedDays,
  replaceOpenDays,
  tallyDaily,
  type DailyTracks,
} from "../lib/metrics";
import { parseProducts, type NormalizedOrder, type ParsedProduct } from "../lib/parse";

const products = parseProducts({
  products: [
    { sku: "Gember", title: "100% PUUR GEMBERSAP 1 Fles", OPSLAG: 100, is_set: false },
    { sku: "appelgember1", title: "APPEL- CITROEN GEMBER ™ - 1 Fles", OPSLAG: 50, is_set: false },
  ],
});

function order(partial: {
  id: number;
  sku: string;
  qty: number;
  ship: string;
  track: string;
  pick?: number;
  extraSku?: string | null;
}): NormalizedOrder {
  return {
    id: partial.id,
    name: `#${partial.id}`,
    status: "COMPLETE",
    createdAt: partial.ship,
    pickorderIds: partial.pick ? [partial.pick] : [],
    ambiguousPick: false,
    lines: [
      {
        sku: partial.sku,
        title: partial.sku,
        quantity: partial.qty,
        quantityFromPayload: true,
        status: "COMPLETE",
      },
      ...(partial.extraSku === null
        ? [{ sku: null, title: null, quantity: 4, quantityFromPayload: true, status: "COMPLETE" }]
        : []),
    ],
    parcels: [
      {
        createdAt: partial.ship,
        hasPdf: true,
        carrierTrack: partial.track,
        carrier: "cirro",
        packageType: "CR",
        printedAt: partial.ship,
      },
    ],
  };
}

function bottlesOn(days: DailyTracks, date: string): number {
  return tallyDaily(days, [date], true).bottlesInAverage;
}

test("per-day aggregation combines a shared parcel and skips a blank sku", () => {
  const { days } = collectDailyUsage(
    [
      order({ id: 1, sku: "Gember", qty: 6, ship: "2026-11-06T10:00:00Z", track: "SAME", pick: 9, extraSku: null }),
      order({ id: 2, sku: "Gember", qty: 6, ship: "2026-11-06T10:00:00Z", track: "SAME", pick: 9 }),
      order({ id: 3, sku: "Gember", qty: 3, ship: "2026-11-04T10:00:00Z", track: "OLD" }),
    ],
    products,
  );
  const sixth = tallyDaily(days, ["2026-11-06"], true);
  assert.equal(sixth.parcelsInAverage, 1);
  assert.equal(sixth.bottlesInAverage, 12);
  assert.equal(sixth.summedBoxes[12], 1);
  assert.equal(sixth.summedBoxes[6], 0);
  assert.equal(bottlesOn(days, "2026-11-04"), 3);
  assert.equal(sixth.summedBoxes[12], 1);
});

test("incremental refresh replaces today and yesterday and leaves a closed day", () => {
  const closed = collectDailyUsage(
    [order({ id: 1, sku: "Gember", qty: 5, ship: "2026-11-01T12:00:00Z", track: "CLOSED" })],
    products,
  ).days;
  const fresh = collectDailyUsage(
    [
      order({ id: 1, sku: "Gember", qty: 20, ship: "2026-11-01T12:00:00Z", track: "CLOSED" }),
      order({ id: 8, sku: "Gember", qty: 6, ship: "2026-11-08T12:00:00Z", track: "OPEN" }),
    ],
    products,
  ).days;

  const stored = replaceOpenDays(closed, fresh, ["2026-11-08", "2026-11-09"]);
  assert.equal(bottlesOn(stored, "2026-11-01"), 5);
  assert.equal(tallyDaily(stored, ["2026-11-01"], true).summedBoxes[12], 1);
  assert.equal(bottlesOn(stored, "2026-11-08"), 6);
  assert.equal(tallyDaily(stored, ["2026-11-08"], true).summedBoxes[6], 1);
  assert.deepEqual(stored["2026-11-09"], {});
});

test("backfill merges two pages of the same parcel into one box", () => {
  const first = collectDailyUsage(
    [order({ id: 1, sku: "Gember", qty: 6, ship: "2026-10-28T10:00:00Z", track: "PAGE", pick: 4 })],
    products,
  ).days;
  const second = collectDailyUsage(
    [order({ id: 2, sku: "Gember", qty: 6, ship: "2026-10-28T10:00:00Z", track: "PAGE", pick: 4 })],
    products,
  ).days;
  const merged = mergeClosedDays(first, second, "2026-11-08");
  const tally = tallyDaily(merged, ["2026-10-28"], true);
  assert.equal(tally.parcelsInAverage, 1);
  assert.equal(tally.bottlesInAverage, 12);
  assert.equal(tally.summedBoxes[12], 1);
  assert.equal(merged["2026-11-08"], undefined);
});

test("known dates stay empty until yesterday has been refreshed", () => {
  const now = "2026-11-09T07:00:00Z";
  const store = emptyHistory(now);
  assert.deepEqual(knownDates(store, now, "2026-11-09"), []);
  store.openRefreshedAt = now;
  assert.deepEqual(knownDates(store, now, "2026-11-09").sort(), ["2026-11-08", "2026-11-09"]);
});
