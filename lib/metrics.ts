import { BOX6_SINCE, ORANGE_BELOW_DAYS, RED_BELOW_DAYS } from "./config";
import {
  isTestOrder,
  parseOrders,
  parseProducts,
  shippedParcels,
  type NormalizedOrder,
  type ParsedProduct,
} from "./parse";
import { addUnits, bottleCount, classifySku, emptyUnits, type UnitKey, type Units } from "./sku";
import { daysBetween, johannesburgDate, reportWindow } from "./time";

export type Flag = "red" | "orange" | "ok" | "idle" | "unknown";

export type CaveatCode =
  | "missing-line-detail"
  | "partial-day"
  | "short-coverage"
  | "tape-per-parcel"
  | "gember32-virtual"
  | "canceled-with-label"
  | "seller-not-listed"
  | "history-building"
  | "stock-stale";

export type UnknownCounts = {
  total: number;
  sku: number;
  over48: number;
  ambiguous: number;
};

export type StockRow = {
  id: string;
  label: string;
  hint: string;
  stock: number | null;
  /** Units consumed in the averaged days. Null when the feed cannot support the figure. */
  used: number | null;
  avgPerDay: number | null;
  daysOfCover: number | null;
  flag: Flag;
};

export type DayPoint = {
  date: string;
  parcels: number | null;
  bottles: number | null;
  partial: boolean;
  inAverage: boolean;
};

export type Dashboard = {
  mode: "sample" | "live";
  periodDays: number;
  windowStart: string;
  windowEnd: string;
  /** First and last day that actually went into the average. */
  averageStart: string;
  averageEnd: string;
  partialDate: string | null;
  averagedDays: number;
  stockUpdatedAt: string | null;
  fetchedAt: string;
  anchorAt: string;
  chartUnit: "flessen" | "pakketten";
  rows: StockRow[];
  packaging: StockRow[];
  days: DayPoint[];
  parcelsInAverage: number;
  bottlesInAverage: number | null;
  unknown: UnknownCounts | null;
  canceledShippedOrders: number;
  caveats: CaveatCode[];
  sellerNote: string | null;
  stockStale: boolean;
};

type BoxSize = 6 | 12 | 30 | 48;
type UnknownReason = "sku" | "over48" | "ambiguous";

type Shipment = {
  date: string | null;
  key: string;
  units: Units | null;
  bottles: number | null;
  box: BoxSize | null;
  unknown: UnknownReason | null;
  parcel: boolean;
  canceled: boolean;
};

export type TrackUsage = {
  units: Units;
  unknown: UnknownReason | null;
  parcel: boolean;
  canceled: boolean;
};

/** Johannesburg day -> tracking code (or an internal key) -> combined parcel. */
export type DailyTracks = Record<string, Record<string, TrackUsage>>;

const PRODUCT_ROWS: { id: string; label: string; hint: string; sku: string; key: UnitKey }[] = [
  { id: "gember", label: "Gembersap", hint: "Losse fles · Gember", sku: "Gember", key: "gember" },
  { id: "appel", label: "Appel-citroen gember", hint: "Losse fles · appelgember1", sku: "appelgember1", key: "appel" },
  { id: "granaat", label: "Granaatappelsap", hint: "Losse fles · Granaatappel1", sku: "Granaatappel1", key: "granaat" },
  { id: "shot", label: "Shotglaasjes", hint: "Shotglaasje · vult geen doos", sku: "Shotglaasje", key: "shot" },
  { id: "onderzetter", label: "Onderzetters", hint: "Onderzetter · vult geen doos", sku: "Onderzetter", key: "onderzetter" },
];

const PACK_ROWS: { id: string; label: string; hint: string; sku: string; box?: BoxSize; tape?: boolean }[] = [
  { id: "box6", label: "Doos 6", hint: "Box6 · sinds 5 nov 2026", sku: "Box6", box: 6 },
  { id: "box12", label: "Doos 12", hint: "Box12", sku: "Box12", box: 12 },
  { id: "box30", label: "Doos 30", hint: "Box30", sku: "Box30", box: 30 },
  { id: "box48", label: "Doos 48", hint: "Box48", sku: "Box48", box: 48 },
  { id: "sep6", label: "Vakverdeling 6", hint: "Seperator6 · 1 per doos 6", sku: "Seperator6", box: 6 },
  { id: "sep12", label: "Vakverdeling 12", hint: "Seperator12 · 1 per doos 12", sku: "Seperator12", box: 12 },
  { id: "sep30", label: "Vakverdeling 30", hint: "Seperator30 · 1 per doos 30", sku: "Seperator30", box: 30 },
  { id: "sep48", label: "Vakverdeling 48", hint: "Seperator48 · 1 per doos 48", sku: "Seperator48", box: 48 },
  { id: "tape", label: "Tape", hint: "Tape · 1 per pakket", sku: "Tape", tape: true },
];

export function boxForBottles(bottles: number, shipDate: string): BoxSize | null {
  if (!Number.isInteger(bottles) || bottles <= 0 || bottles > 48) return null;
  if (bottles <= 6) return shipDate >= BOX6_SINCE ? 6 : 12;
  if (bottles <= 12) return 12;
  if (bottles <= 30) return 30;
  return 48;
}

export function flagFor(days: number | null, average: number | null): Flag {
  if (average == null || days == null) return "unknown";
  if (average <= 0) return "idle";
  if (days < RED_BELOW_DAYS) return "red";
  if (days < ORANGE_BELOW_DAYS) return "orange";
  return "ok";
}

function hasLineDetail(orders: NormalizedOrder[]): boolean {
  return orders.some((order) => order.lines.some((line) => line.sku != null || line.title != null || line.quantityFromPayload));
}

function titleIndex(products: ParsedProduct[]): Map<string, string> {
  const buckets = new Map<string, Set<string>>();
  for (const product of products) {
    const key = product.title.trim().toLowerCase().replace(/\s+/g, " ");
    const skus = buckets.get(key) ?? new Set<string>();
    skus.add(product.sku);
    buckets.set(key, skus);
  }
  const unique = new Map<string, string>();
  for (const [title, skus] of buckets) {
    if (skus.size === 1) unique.set(title, [...skus][0]);
  }
  return unique;
}

function stockIndex(products: ParsedProduct[]): Map<string, ParsedProduct> {
  const map = new Map<string, ParsedProduct>();
  for (const product of products) {
    const key = product.sku.toLowerCase();
    const existing = map.get(key);
    if (!existing || (existing.isSet && !product.isSet)) map.set(key, product);
  }
  return map;
}

function resolveSku(sku: string | null, title: string | null, titles: Map<string, string>): string | null {
  if (sku) return sku;
  if (!title) return null;
  return titles.get(title.trim().toLowerCase().replace(/\s+/g, " ")) ?? null;
}

function buildShipments(orders: NormalizedOrder[], products: ParsedProduct[], lineDetail: boolean): { shipments: Shipment[]; canceledShippedOrders: number } {
  const titles = titleIndex(products);
  const active = orders.filter((order) => !isTestOrder(order));
  const parent = active.map((_, index) => index);
  const find = (index: number): number => {
    let cursor = index;
    while (parent[cursor] !== cursor) {
      parent[cursor] = parent[parent[cursor]];
      cursor = parent[cursor];
    }
    return cursor;
  };
  const union = (left: number, right: number) => {
    const a = find(left);
    const b = find(right);
    if (a !== b) parent[b] = a;
  };

  const byPick = new Map<number, number[]>();
  const byTrack = new Map<string, number[]>();
  active.forEach((order, index) => {
    if (!order.ambiguousPick) {
      for (const pickId of order.pickorderIds) {
        const list = byPick.get(pickId) ?? [];
        list.push(index);
        byPick.set(pickId, list);
      }
    }
    for (const parcel of shippedParcels(order)) {
      const track = parcel.carrierTrack!.trim();
      const list = byTrack.get(track) ?? [];
      list.push(index);
      byTrack.set(track, list);
    }
  });
  for (const indexes of byPick.values()) indexes.forEach((index) => union(indexes[0], index));
  for (const indexes of byTrack.values()) indexes.forEach((index) => union(indexes[0], index));

  const groups = new Map<number, NormalizedOrder[]>();
  active.forEach((order, index) => {
    const root = find(index);
    const list = groups.get(root) ?? [];
    list.push(order);
    groups.set(root, list);
  });

  const shipments: Shipment[] = [];
  let canceledShippedOrders = 0;

  for (const members of groups.values()) {
    const parcels = members.flatMap((order) => shippedParcels(order));
    if (parcels.length === 0) continue;
    const canceled = members.some((order) => (order.status ?? "").toUpperCase() === "CANCELED");
    if (canceled) canceledShippedOrders += 1;

    const tracks = new Set(parcels.map((parcel) => parcel.carrierTrack!.trim()));
    const dates = [...new Set(parcels.map((parcel) => (parcel.createdAt ? johannesburgDate(parcel.createdAt) : "")).filter(Boolean))].sort();
    const date = dates[0] ?? null;
    const structural = members.some((order) => order.ambiguousPick) || tracks.size !== 1 || dates.length !== 1;

    const units = emptyUnits();
    let lineProblem = false;
    if (lineDetail) {
      for (const order of members) {
        for (const line of order.lines) {
          if (!line.quantityFromPayload) {
            if (line.status && /^(canceled|cancelled|geannuleerd)$/i.test(line.status)) continue;
            lineProblem = true;
            continue;
          }
          if (line.quantity == null || !Number.isInteger(line.quantity)) {
            lineProblem = true;
            continue;
          }
          if (line.quantity === 0) continue;
          const sku = resolveSku(line.sku, line.title, titles);
          // About 1% of StockItUp lines have no sku and no title. Skip them.
          // A sku we do not recognise still makes the parcel's box unknown.
          if (!sku) {
            if (!line.sku && !line.title) continue;
            lineProblem = true;
            continue;
          }
          const rule = classifySku(sku);
          if (rule.kind === "unknown") {
            lineProblem = true;
            continue;
          }
          if (rule.kind === "ignore") continue;
          addUnits(units, rule.units, line.quantity);
        }
      }
    }

    const bottles = lineDetail ? bottleCount(units) : null;
    let unknown: UnknownReason | null = null;
    if (lineDetail) {
      if (structural) unknown = "ambiguous";
      else if (lineProblem) unknown = "sku";
      else if ((bottles ?? 0) > 48) unknown = "over48";
    }

    const trackId = tracks.size === 1 ? [...tracks][0] : "";
    const countableParcel = !structural && date != null;
    const key = countableParcel && trackId ? trackId : `~${members.map((order) => order.id ?? "x").join("-")}`;
    shipments.push({
      date,
      key,
      units: lineDetail ? units : null,
      bottles,
      box: lineDetail && unknown == null && date ? boxForBottles(bottles ?? 0, date) : null,
      unknown,
      parcel: countableParcel,
      canceled,
    });
  }

  return { shipments, canceledShippedOrders };
}

export function collectDailyUsage(orders: NormalizedOrder[], products: ParsedProduct[]): { days: DailyTracks; lineDetail: boolean } {
  const lineDetail = hasLineDetail(orders);
  const { shipments } = buildShipments(orders, products, lineDetail);
  const days: DailyTracks = {};
  for (const shipment of shipments) {
    if (!shipment.date) continue;
    const bucket = days[shipment.date] ?? {};
    bucket[shipment.key] = {
      units: shipment.units ?? emptyUnits(),
      unknown: shipment.unknown,
      parcel: shipment.parcel,
      canceled: shipment.canceled,
    };
    days[shipment.date] = bucket;
  }
  return { days, lineDetail };
}

export function tallyDaily(days: DailyTracks, averageDates: string[], lineDetail: boolean): {
  parcelsByDay: Map<string, number>;
  bottlesByDay: Map<string, number>;
  summedUnits: Units;
  summedBoxes: Record<BoxSize, number>;
  unknown: UnknownCounts;
  parcelsInAverage: number;
  bottlesInAverage: number;
  tapeInAverage: number;
  canceledShippedOrders: number;
} {
  const averageSet = new Set(averageDates);
  const parcelsByDay = new Map<string, number>();
  const bottlesByDay = new Map<string, number>();
  const summedUnits = emptyUnits();
  const summedBoxes: Record<BoxSize, number> = { 6: 0, 12: 0, 30: 0, 48: 0 };
  const unknown: UnknownCounts = { total: 0, sku: 0, over48: 0, ambiguous: 0 };
  let parcelsInAverage = 0;
  let bottlesInAverage = 0;
  let tapeInAverage = 0;
  let canceledShippedOrders = 0;

  for (const [date, tracks] of Object.entries(days)) {
    let parcels = 0;
    let bottles = 0;
    for (const track of Object.values(tracks)) {
      if (track.canceled) canceledShippedOrders += 1;
      if (!track.parcel) {
        if (averageSet.has(date) && lineDetail && track.unknown) {
          unknown.total += 1;
          unknown[track.unknown] += 1;
        }
        continue;
      }
      parcels += 1;
      const trackBottles = bottleCount(track.units);
      if (lineDetail && track.unknown !== "ambiguous") bottles += trackBottles;
      if (!averageSet.has(date)) continue;
      parcelsInAverage += 1;
      tapeInAverage += 1;
      if (!lineDetail || track.unknown === "ambiguous") {
        if (lineDetail && track.unknown) {
          unknown.total += 1;
          unknown[track.unknown] += 1;
        }
        continue;
      }
      addUnits(summedUnits, track.units, 1);
      bottlesInAverage += trackBottles;
      if (track.unknown) {
        unknown.total += 1;
        unknown[track.unknown] += 1;
      } else {
        const box = boxForBottles(trackBottles, date);
        if (box) summedBoxes[box] += 1;
      }
    }
    parcelsByDay.set(date, parcels);
    bottlesByDay.set(date, bottles);
  }

  return {
    parcelsByDay,
    bottlesByDay,
    summedUnits,
    summedBoxes,
    unknown,
    parcelsInAverage,
    bottlesInAverage,
    tapeInAverage,
    canceledShippedOrders,
  };
}

export function mergeTrackUsage(left: TrackUsage, right: TrackUsage): TrackUsage {
  const units = emptyUnits();
  addUnits(units, left.units, 1);
  addUnits(units, right.units, 1);
  let unknown: UnknownReason | null = null;
  if (left.unknown === "ambiguous" || right.unknown === "ambiguous") unknown = "ambiguous";
  else if (left.unknown === "sku" || right.unknown === "sku") unknown = "sku";
  else if (bottleCount(units) > 48) unknown = "over48";
  return {
    units,
    unknown,
    parcel: left.parcel || right.parcel,
    canceled: left.canceled || right.canceled,
  };
}

/** Replace today and yesterday with a fresh count. Older days stay as they were. */
export function replaceOpenDays(base: DailyTracks, fresh: DailyTracks, dates: string[]): DailyTracks {
  const next: DailyTracks = {};
  for (const [date, tracks] of Object.entries(base)) {
    if (!dates.includes(date)) next[date] = tracks;
  }
  for (const date of dates) next[date] = fresh[date] ?? {};
  return next;
}

/** Fold a backfill page into closed days. Open days are left for the incremental refresh. */
export function mergeClosedDays(base: DailyTracks, extra: DailyTracks, openFrom: string): DailyTracks {
  const next: DailyTracks = { ...base };
  for (const [date, tracks] of Object.entries(extra)) {
    if (date >= openFrom) continue;
    const bucket = { ...(next[date] ?? {}) };
    for (const [key, track] of Object.entries(tracks)) {
      bucket[key] = bucket[key] ? mergeTrackUsage(bucket[key], track) : track;
    }
    next[date] = bucket;
  }
  return next;
}

function observedBounds(orders: NormalizedOrder[]): { start: string | null; end: string | null } {
  const dates: string[] = [];
  for (const order of orders) {
    if (isTestOrder(order)) continue;
    if (order.createdAt) dates.push(johannesburgDate(order.createdAt));
    for (const parcel of order.parcels) {
      if (parcel.createdAt) dates.push(johannesburgDate(parcel.createdAt));
    }
  }
  if (dates.length === 0) return { start: null, end: null };
  dates.sort();
  return { start: dates[0], end: dates[dates.length - 1] };
}

function latestIso(orders: NormalizedOrder[], products: ParsedProduct[]): string | null {
  const stamps: string[] = [];
  for (const product of products) if (product.updatedStockAt) stamps.push(product.updatedStockAt);
  for (const order of orders) {
    if (order.createdAt) stamps.push(order.createdAt);
    for (const parcel of order.parcels) {
      if (parcel.createdAt) stamps.push(parcel.createdAt);
      if (parcel.printedAt) stamps.push(parcel.printedAt);
    }
  }
  const valid = stamps.filter((stamp) => !Number.isNaN(new Date(stamp).getTime()));
  valid.sort((left, right) => new Date(left).getTime() - new Date(right).getTime());
  return valid.length ? valid[valid.length - 1] : null;
}

function rowFrom(input: {
  id: string;
  label: string;
  hint: string;
  stock: number | null;
  used: number | null;
  averagedDays: number;
}): StockRow {
  const avgPerDay = input.used == null || input.averagedDays <= 0 ? null : input.used / input.averagedDays;
  const daysOfCover = avgPerDay == null || input.stock == null ? null : avgPerDay > 0 ? input.stock / avgPerDay : input.stock > 0 ? Number.POSITIVE_INFINITY : null;
  return {
    id: input.id,
    label: input.label,
    hint: input.hint,
    stock: input.stock,
    used: input.used,
    avgPerDay,
    daysOfCover: daysOfCover != null && Number.isFinite(daysOfCover) ? daysOfCover : daysOfCover,
    flag: flagFor(daysOfCover, avgPerDay),
  };
}

export function buildDashboard(input: {
  productsPayload: unknown;
  ordersPayload: unknown;
  periodDays: number;
  mode: "sample" | "live";
  fetchedAt: string;
  /** Live fetches already cover this Johannesburg date; earlier days are real zeros. */
  coverageStart?: string | null;
  /** When set, only these Johannesburg days count. Missing days are not treated as zero. */
  knownDates?: string[] | null;
  historyBuilding?: boolean;
  stockStale?: boolean;
  /** Precomputed day tracks. Sample mode builds them from ordersPayload. */
  daily?: DailyTracks | null;
  sellerNote?: string | null;
  sellerMissing?: boolean;
}): Dashboard {
  const products = parseProducts(input.productsPayload);
  const orders = parseOrders(input.ordersPayload);
  const collected = input.daily
    ? { days: input.daily, lineDetail: true }
    : collectDailyUsage(orders, products);
  const lineDetail = collected.lineDetail;
  const anchorAt = input.mode === "sample" ? latestIso(orders, products) ?? input.fetchedAt : input.fetchedAt;
  const window = reportWindow(anchorAt, input.periodDays);
  const observed = observedBounds(orders);

  const averageDates = daysBetween(window.start, window.end).filter((date) => {
    if (input.knownDates) return input.knownDates.includes(date);
    if (input.mode === "live") return !input.coverageStart || date >= input.coverageStart;
    if (!observed.start || !observed.end) return false;
    return date >= observed.start && date <= observed.end;
  });
  const tally = tallyDaily(collected.days, averageDates, lineDetail);
  const { parcelsByDay, bottlesByDay, summedUnits, summedBoxes, unknown } = tally;
  const { parcelsInAverage, bottlesInAverage, tapeInAverage, canceledShippedOrders } = tally;

  const stock = stockIndex(products);
  const stockOf = (sku: string) => stock.get(sku.toLowerCase())?.opslag ?? null;
  const averagedDays = averageDates.length;
  const productUsed = (key: UnitKey) => (lineDetail ? summedUnits[key] : null);
  const boxUsed = (size: BoxSize) => (lineDetail ? summedBoxes[size] : null);

  const rows = PRODUCT_ROWS.map((item) =>
    rowFrom({
      id: item.id,
      label: item.label,
      hint: item.hint,
      stock: stockOf(item.sku),
      used: productUsed(item.key),
      averagedDays,
    }),
  );
  const packaging = PACK_ROWS.map((item) =>
    rowFrom({
      id: item.id,
      label: item.label,
      hint: item.hint,
      stock: stockOf(item.sku),
      used: item.tape ? tapeInAverage : item.box ? boxUsed(item.box) : null,
      averagedDays,
    }),
  );

  const chartStart =
    input.mode === "sample" && observed.start && observed.start > window.start ? observed.start : window.start;
  const chartDates = daysBetween(chartStart, window.chartEnd);
  const days: DayPoint[] = chartDates.map((date) => {
    const inCoverage = input.knownDates
      ? input.knownDates.includes(date)
      : input.mode === "live"
        ? !input.coverageStart || date >= input.coverageStart
        : Boolean(observed.start && observed.end && date >= observed.start && date <= observed.end);
    return {
      date,
      parcels: inCoverage ? parcelsByDay.get(date) ?? 0 : null,
      bottles: lineDetail && inCoverage ? bottlesByDay.get(date) ?? 0 : null,
      partial: date === window.partialDate,
      inAverage: averageDates.includes(date),
    };
  });

  const caveats: CaveatCode[] = ["tape-per-parcel"];
  if (!lineDetail) caveats.unshift("missing-line-detail");
  if (window.partialDate) caveats.push("partial-day");
  if (averagedDays < input.periodDays) caveats.push("short-coverage");
  if (canceledShippedOrders > 0) caveats.push("canceled-with-label");
  if (input.sellerMissing) caveats.push("seller-not-listed");
  if (input.historyBuilding) caveats.push("history-building");
  if (input.stockStale) caveats.push("stock-stale");

  const gember = stockOf("Gember");
  const gember32 = stockOf("Gember32");
  if (
    gember != null &&
    gember32 != null &&
    gember32 === Math.floor(gember / 32) &&
    gember32 !== Math.floor(gember / 16)
  ) {
    caveats.push("gember32-virtual");
  }

  const stockUpdatedAt = products.reduce<string | null>((latest, product) => {
    if (!product.updatedStockAt || Number.isNaN(new Date(product.updatedStockAt).getTime())) return latest;
    if (!latest || new Date(product.updatedStockAt).getTime() > new Date(latest).getTime()) return product.updatedStockAt;
    return latest;
  }, null);

  return {
    mode: input.mode,
    periodDays: input.periodDays,
    windowStart: window.start,
    windowEnd: window.end,
    averageStart: averageDates[0] ?? window.start,
    averageEnd: averageDates[averageDates.length - 1] ?? window.end,
    partialDate: window.partialDate,
    averagedDays,
    stockUpdatedAt,
    fetchedAt: input.fetchedAt,
    anchorAt,
    chartUnit: lineDetail ? "flessen" : "pakketten",
    rows,
    packaging,
    days,
    parcelsInAverage,
    bottlesInAverage: lineDetail ? bottlesInAverage : null,
    unknown: lineDetail ? unknown : null,
    canceledShippedOrders,
    caveats,
    sellerNote: input.sellerNote ?? null,
    stockStale: input.stockStale === true,
  };
}
