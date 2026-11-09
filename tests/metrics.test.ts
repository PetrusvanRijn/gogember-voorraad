import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { buildDashboard } from "../lib/metrics";
import { classifySku } from "../lib/sku";
import { parseProducts } from "../lib/parse";

const productsPayload = JSON.parse(fs.readFileSync("data/sample-products.json", "utf8"));
const ordersPayload = JSON.parse(fs.readFileSync("data/sample-orders.json", "utf8"));

function row(data: ReturnType<typeof buildDashboard>, id: string) {
  return [...data.rows, ...data.packaging].find((item) => item.id === id);
}

test("every catalogue SKU has an explicit bottle rule", () => {
  for (const product of parseProducts(productsPayload)) {
    assert.notEqual(classifySku(product.sku).kind, "unknown", product.sku);
  }
});

test("sample snapshot: physical stock, parcels and no invented bottle usage", () => {
  const data = buildDashboard({
    productsPayload,
    ordersPayload,
    periodDays: 7,
    mode: "sample",
    fetchedAt: "2026-11-09T07:00:00Z",
  });

  assert.equal(data.windowStart, "2026-11-02");
  assert.equal(data.windowEnd, "2026-11-08");
  assert.equal(data.partialDate, "2026-11-09");
  assert.equal(data.averagedDays, 7);
  assert.equal(data.chartUnit, "pakketten");
  assert.equal(data.parcelsInAverage, 1463);
  assert.equal(data.bottlesInAverage, null);
  assert.equal(data.unknown, null);
  assert.ok(data.caveats.includes("missing-line-detail"));
  assert.ok(data.caveats.includes("gember32-virtual"));
  assert.equal(data.canceledShippedOrders, 5);

  assert.equal(row(data, "gember")?.stock, 28150);
  assert.equal(row(data, "appel")?.stock, 4809);
  assert.equal(row(data, "granaat")?.stock, 17138);
  assert.equal(row(data, "shot")?.stock, 1223);
  assert.equal(row(data, "onderzetter")?.stock, 4);
  assert.equal(row(data, "box6")?.stock, 1980);
  assert.equal(row(data, "box12")?.stock, 10810);
  assert.equal(row(data, "box30")?.stock, 770);
  assert.equal(row(data, "box48")?.stock, 590);
  assert.equal(row(data, "sep6")?.stock, 9900);
  assert.equal(row(data, "sep12")?.stock, 25090);
  assert.equal(row(data, "sep30")?.stock, 1740);
  assert.equal(row(data, "sep48")?.stock, 825);
  assert.equal(row(data, "tape")?.stock, 408);

  for (const id of ["gember", "appel", "granaat", "shot", "onderzetter", "box6", "box12", "sep12"]) {
    assert.equal(row(data, id)?.flag, "unknown");
    assert.equal(row(data, id)?.avgPerDay, null);
  }

  const tape = row(data, "tape");
  assert.equal(tape?.used, 1463);
  assert.equal(tape?.avgPerDay, 209);
  assert.ok(Math.abs((tape?.daysOfCover ?? 0) - 408 / 209) < 1e-9);
  assert.equal(tape?.flag, "red");

  const byDate = Object.fromEntries(data.days.map((day) => [day.date, day.parcels]));
  assert.deepEqual(byDate, {
    "2026-11-02": 364,
    "2026-11-03": 251,
    "2026-11-04": 168,
    "2026-11-05": 158,
    "2026-11-06": 176,
    "2026-11-07": 164,
    "2026-11-08": 182,
    "2026-11-09": 36,
  });
  assert.equal(data.days.find((day) => day.date === "2026-11-09")?.partial, true);
  assert.equal(data.days.find((day) => day.date === "2026-11-09")?.inAverage, false);
});

test("28 days uses only the days the snapshot actually covers", () => {
  const data = buildDashboard({
    productsPayload,
    ordersPayload,
    periodDays: 28,
    mode: "sample",
    fetchedAt: "2026-11-09T07:00:00Z",
  });
  assert.equal(data.averagedDays, 17);
  assert.equal(data.averageStart, "2026-10-23");
  assert.equal(data.averageEnd, "2026-11-08");
  assert.equal(data.parcelsInAverage, 1718);
  assert.ok(data.caveats.includes("short-coverage"));
  const tape = row(data, "tape");
  assert.ok(Math.abs((tape?.avgPerDay ?? 0) - 1718 / 17) < 1e-9);
});

function catalog() {
  const item = (sku: string, opslag: number, title = sku) => ({
    sku,
    title,
    OPSLAG: opslag,
    is_set: false,
    updated_stock_at: "2026-11-08T20:00:00Z",
  });
  return {
    products: [
      item("Gember", 1000),
      item("appelgember1", 1000),
      item("Granaatappel1", 1000),
      item("Shotglaasje", 100),
      item("Onderzetter", 4),
      item("Box6", 50),
      item("Box12", 50),
      item("Box30", 50),
      item("Box48", 50),
      item("Seperator6", 50),
      item("Seperator12", 50),
      item("Seperator30", 50),
      item("Seperator48", 50),
      item("Tape", 50),
    ],
  };
}

function parcel(track: string, createdAt: string) {
  return { created_at: createdAt, has_pdf: true, carrier_track: track, carrier: "cirro", package_type: "CR", printed_at: createdAt };
}

function dashboard(orders: unknown[]) {
  return buildDashboard({
    productsPayload: catalog(),
    ordersPayload: orders,
    periodDays: 7,
    mode: "sample",
    fetchedAt: "2026-11-08T20:00:00Z",
  });
}

test("bottle rules, box sizes and combined pickorders", () => {
  const ship = "2026-11-06T10:00:00Z";
  const data = dashboard([
    {
      id: 1,
      status: "COMPLETE",
      created_at: ship,
      pickorder_ids: [9],
      order_items: [
        { sku: "Gember1", quantity: 1, status: "COMPLETE" },
        { sku: "Shotglaasje2x", quantity: 1, status: "COMPLETE" },
      ],
      parcels: [parcel("SAME", ship)],
    },
    {
      id: 2,
      status: "COMPLETE",
      created_at: ship,
      pickorder_ids: [9],
      order_items: [{ sku: "combi2+5", quantity: 1, cancelled: 0, status: "COMPLETE" }],
      parcels: [parcel("SAME", ship)],
    },
    {
      id: 3,
      status: "COMPLETE",
      created_at: "2026-11-04T10:00:00Z",
      order_items: [{ sku: "Gember", quantity: "5", cancelled_quantity: 1, status: "COMPLETE" }],
      parcels: [parcel("OLD", "2026-11-04T10:00:00Z")],
    },
    {
      id: 4,
      status: "COMPLETE",
      created_at: "2026-11-04T22:30:00Z",
      order_items: [{ sku: "Gember32", quantity: 1, status: "COMPLETE" }],
      parcels: [parcel("TZ", "2026-11-04T22:30:00Z")],
    },
    {
      id: 5,
      name: "Test bestelling",
      status: "COMPLETE",
      created_at: ship,
      order_items: [{ sku: "Gember", quantity: 40, status: "COMPLETE" }],
      parcels: [parcel("TEST", ship)],
    },
    {
      id: 6,
      status: "COMPLETE",
      created_at: ship,
      order_items: [
        { sku: "Gember", quantity: 2, status: "COMPLETE" },
        { sku: "NIEUW-SKU", quantity: 1, title: "Iets nieuws", status: "COMPLETE" },
      ],
      parcels: [parcel("UNK", ship)],
    },
    {
      id: 7,
      status: "COMPLETE",
      created_at: ship,
      order_items: [{ sku: "Gember", quantity: 49, status: "COMPLETE" }],
      parcels: [parcel("BIG", ship)],
    },
  ]);

  // Pick 9 is one parcel: Gember1 (3) + combi2+5 (2 gember + 5 appel) = 5 gember, 5 appel, 10 bottles → box 12.
  // Plus the pre-cutoff order: 4 gember in box 12.
  // Plus the timezone order: Gember32 = 16 gember on 5 Nov → box 30.
  // Unknown SKU still counts its 2 known gember bottles, no box.
  // 49 bottles count as gember and no box.
  // The test order is ignored.
  assert.equal(row(data, "gember")?.used, 5 + 4 + 16 + 2 + 49);
  assert.equal(row(data, "appel")?.used, 5);
  assert.equal(row(data, "shot")?.used, 2);
  assert.equal(row(data, "box6")?.used, 0);
  assert.equal(row(data, "box12")?.used, 2);
  assert.equal(row(data, "box30")?.used, 1);
  assert.equal(row(data, "sep12")?.used, 2);
  assert.equal(row(data, "sep30")?.used, 1);
  assert.equal(row(data, "tape")?.used, 5);
  assert.equal(data.unknown?.sku, 1);
  assert.equal(data.unknown?.over48, 1);
  assert.equal(data.unknown?.total, 2);
  assert.equal(data.parcelsInAverage, 5);
});

test("nested order fields and an order-level label still ship", () => {
  const data = dashboard([
    {
      id: 8,
      status: "COMPLETE",
      created_at: "2026-11-06T08:00:00Z",
      orderlines: [{ product: { sku: "Gember1", name: "3 flessen" }, qty: "2", status: "COMPLETE" }],
      shipments: [{ createdAt: "2026-11-06T08:00:00Z", hasPdf: 1, tracking_code: "NEST", carrier: "x" }],
    },
    {
      id: 9,
      status: "SHIPPING",
      created_at: "2026-11-06T09:00:00Z",
      carrier_track: "LABEL",
      label_id: "abc",
      items: [{ sku: "gegrac13", quantity: 1, status: "OPEN" }],
    },
  ]);
  // Gember1 × 2 = 6 bottles → box 6. gegrac13 = 3 gember + 5 granaat + 5 appel = 13 → box 30.
  assert.equal(row(data, "gember")?.used, 6 + 3);
  assert.equal(row(data, "appel")?.used, 5);
  assert.equal(row(data, "granaat")?.used, 5);
  assert.equal(row(data, "box6")?.used, 1);
  assert.equal(row(data, "box30")?.used, 1);
  assert.equal(row(data, "tape")?.used, 2);
});

test("orders that share a pickorder but not a tracking code are unknown", () => {
  const ship = "2026-11-06T10:00:00Z";
  const data = dashboard([
    {
      id: 1,
      status: "COMPLETE",
      created_at: ship,
      pickorder_ids: [3],
      order_items: [{ sku: "Gember", quantity: 6, status: "COMPLETE" }],
      parcels: [parcel("A", ship)],
    },
    {
      id: 2,
      status: "COMPLETE",
      created_at: ship,
      pickorder_ids: [3],
      order_items: [{ sku: "Gember", quantity: 6, status: "COMPLETE" }],
      parcels: [parcel("B", ship)],
    },
  ]);
  assert.equal(data.unknown?.ambiguous, 1);
  assert.equal(row(data, "box6")?.used, 0);
  assert.equal(row(data, "box12")?.used, 0);
  assert.equal(row(data, "tape")?.used, 0);
  assert.equal(row(data, "gember")?.used, 0);
});
