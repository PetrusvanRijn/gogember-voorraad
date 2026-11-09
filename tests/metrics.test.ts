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

test("sample snapshot: stock and days of cover from shipped parcels in the window", () => {
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
  assert.equal(data.chartUnit, "flessen");
  assert.equal(data.parcelsInAverage, 1471);
  assert.equal(data.bottlesInAverage, 16049);
  assert.equal(data.unknown?.total, 1);
  assert.equal(data.unknown?.ambiguous, 1);
  assert.ok(!data.caveats.includes("missing-line-detail"));
  assert.ok(data.caveats.includes("gember32-virtual"));

  assert.equal(row(data, "gember")?.stock, 28150);
  assert.equal(row(data, "gember")?.used, 11371);
  assert.ok(Math.abs((row(data, "gember")?.avgPerDay ?? 0) - 11371 / 7) < 1e-9);
  assert.ok(Math.abs((row(data, "gember")?.daysOfCover ?? 0) - 28150 / (11371 / 7)) < 1e-6);
  assert.equal(row(data, "gember")?.flag, "orange");

  assert.equal(row(data, "box12")?.stock, 10810);
  assert.equal(row(data, "box12")?.used, 1176);
  assert.equal(row(data, "box12")?.avgPerDay, 168);
  assert.ok(Math.abs((row(data, "box12")?.daysOfCover ?? 0) - 10810 / 168) < 1e-6);
  assert.equal(row(data, "box12")?.flag, "ok");

  assert.equal(row(data, "sep12")?.stock, 25090);
  assert.equal(row(data, "sep12")?.used, 1176);
  assert.equal(row(data, "sep12")?.avgPerDay, 168);
  assert.ok(Math.abs((row(data, "sep12")?.daysOfCover ?? 0) - 25090 / 168) < 1e-6);

  assert.equal(row(data, "appel")?.stock, 4809);
  assert.equal(row(data, "appel")?.flag, "red");
  assert.equal(row(data, "onderzetter")?.stock, 4);
  assert.equal(row(data, "onderzetter")?.flag, "red");
  assert.equal(row(data, "tape")?.used, 1471);
  assert.equal(row(data, "tape")?.flag, "red");

  const byDate = Object.fromEntries(data.days.filter((day) => day.inAverage).map((day) => [day.date, day.parcels]));
  assert.deepEqual(byDate, {
    "2026-11-02": 364,
    "2026-11-03": 251,
    "2026-11-04": 168,
    "2026-11-05": 158,
    "2026-11-06": 176,
    "2026-11-07": 164,
    "2026-11-08": 190,
  });
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
  assert.equal(data.parcelsInAverage, 4473);
  assert.equal(row(data, "box12")?.used, 3935);
  assert.equal(row(data, "gember")?.used, 34554);
  assert.ok(data.caveats.includes("short-coverage"));
  const tape = row(data, "tape");
  assert.ok(Math.abs((tape?.avgPerDay ?? 0) - 4473 / 17) < 1e-9);
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

test("blank sku lines are skipped and parcels outside the window are not usage", () => {
  const ship = "2026-11-06T10:00:00Z";
  const data = dashboard([
    {
      id: 1,
      status: "COMPLETE",
      created_at: ship,
      order_date: "2024-05-01T10:00:00Z",
      order_items: [
        { product_sku: "Gember", product_title: "1 fles", quantity_ordered: 6, quantity_canceled: 0, status: "COMPLETE" },
        { product_sku: null, product_title: null, quantity_ordered: 4, quantity_canceled: 0, status: "COMPLETE" },
      ],
      parcels: [parcel("NOW", ship)],
    },
    {
      id: 2,
      status: "COMPLETE",
      created_at: "2024-06-01T10:00:00Z",
      order_date: "2024-06-01T10:00:00Z",
      order_items: [{ product_sku: "Gember", product_title: "1 fles", quantity_ordered: 20, quantity_canceled: 0, status: "COMPLETE" }],
      parcels: [parcel("OLD", "2024-06-02T10:00:00Z")],
    },
  ]);
  assert.equal(row(data, "gember")?.used, 6);
  assert.equal(row(data, "box6")?.used, 1);
  assert.equal(data.unknown?.total, 0);
  assert.equal(data.parcelsInAverage, 1);
});
