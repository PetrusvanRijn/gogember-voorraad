export type NormalizedLine = {
  sku: string | null;
  title: string | null;
  /** Units still to count. Null when the payload did not say how many. */
  quantity: number | null;
  /** True when a quantity field was present, so a missing number is not the same as "cancelled". */
  quantityFromPayload: boolean;
  status: string | null;
};

export type NormalizedParcel = {
  createdAt: string | null;
  hasPdf: boolean;
  carrierTrack: string | null;
  carrier: string | null;
  packageType: string | null;
  printedAt: string | null;
};

export type NormalizedOrder = {
  id: number | null;
  name: string | null;
  status: string | null;
  createdAt: string | null;
  pickorderIds: number[];
  /** More than one pickorder, or a pickorder id that was not a number. */
  ambiguousPick: boolean;
  lines: NormalizedLine[];
  parcels: NormalizedParcel[];
};

export type ParsedProduct = {
  id: number | null;
  sku: string;
  title: string;
  opslag: number | null;
  updatedStockAt: string | null;
  isSet: boolean;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim().replace(/\s/g, "").replace(",", ".");
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (isRecord(value)) {
    for (const key of ["quantity", "qty", "value", "amount", "stock", "on_hand", "available", "count"]) {
      if (key in value) {
        const parsed = readNumber(value[key]);
        if (parsed != null) return parsed;
      }
    }
  }
  return null;
}

function readBool(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value === "string") {
    return ["1", "true", "yes", "ja"].includes(value.trim().toLowerCase());
  }
  return false;
}

function readString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function firstString(sources: Record<string, unknown>[], keys: string[]): string | null {
  for (const source of sources) {
    for (const key of keys) {
      const found = readString(source[key]);
      if (found) return found;
    }
  }
  return null;
}

function presentNumber(source: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    if (key in source) return readNumber(source[key]);
  }
  return null;
}

export function extractList(payload: unknown, keys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];
  for (const key of keys) {
    if (Array.isArray(payload[key])) return payload[key] as unknown[];
  }
  for (const value of Object.values(payload)) {
    if (!isRecord(value)) continue;
    for (const key of keys) {
      if (Array.isArray(value[key])) return value[key] as unknown[];
    }
  }
  return [];
}

const QTY_KEYS = ["quantity", "qty", "amount", "count", "quantity_ordered", "ordered_quantity"];
const CANCEL_KEYS = [
  "cancelled",
  "canceled",
  "cancelled_quantity",
  "canceled_quantity",
  "quantity_cancelled",
  "quantity_canceled",
  "qty_cancelled",
  "qty_canceled",
  "cancel_quantity",
  "cancelled_qty",
  "canceled_qty",
];

function lineSources(raw: Record<string, unknown>): Record<string, unknown>[] {
  const sources = [raw];
  for (const key of ["product", "item", "article", "variant"]) {
    if (isRecord(raw[key])) sources.push(raw[key] as Record<string, unknown>);
  }
  return sources;
}

export function parseLine(value: unknown): NormalizedLine | null {
  if (!isRecord(value)) return null;
  const sources = lineSources(value);
  const sku = firstString(sources, ["sku", "SKU", "product_sku", "productSku", "article_sku", "article_code"]);
  const title = firstString(sources, ["title", "titel", "name", "product_title", "product_name"]);
  const status = firstString([value], ["status", "status_label"]);
  const ordered = presentNumber(value, QTY_KEYS);
  const cancelled = presentNumber(value, CANCEL_KEYS);
  const canceled = Boolean(status && /^(canceled|cancelled|geannuleerd)$/i.test(status));
  let quantity: number | null = null;
  if (ordered != null) quantity = Math.max(0, ordered - (cancelled ?? 0));
  if (canceled) quantity = 0;
  return { sku, title, quantity, quantityFromPayload: ordered != null, status };
}

function parseParcel(value: unknown): NormalizedParcel | null {
  if (!isRecord(value)) return null;
  const track = firstString(lineSources(value), [
    "carrier_track",
    "carrierTrack",
    "tracking_code",
    "trackingCode",
    "track_and_trace",
    "barcode",
    "tracking",
  ]);
  return {
    createdAt: firstString([value], ["created_at", "createdAt", "date", "shipped_at"]),
    hasPdf: readBool(value.has_pdf ?? value.hasPdf ?? value.pdf) || Boolean(readString(value.label_id)),
    carrierTrack: track,
    carrier: firstString([value], ["carrier", "carrier_name", "transporter"]),
    packageType: firstString([value], ["package_type", "packageType"]),
    printedAt: firstString([value], ["printed_at", "printedAt"]),
  };
}

function parsePickorders(order: Record<string, unknown>): { ids: number[]; ambiguous: boolean } {
  const raw =
    order.pickorder_ids ?? order.pick_order_ids ?? order.pickorders ?? order.pickorder_id ?? order.pick_order_id;
  if (raw == null || raw === "") return { ids: [], ambiguous: false };
  const list = Array.isArray(raw) ? raw : [raw];
  const ids: number[] = [];
  for (const item of list) {
    const value = isRecord(item) ? readNumber(item.id ?? item.pickorder_id ?? item.pick_order_id) : readNumber(item);
    if (value == null || !Number.isInteger(value)) return { ids, ambiguous: true };
    if (!ids.includes(value)) ids.push(value);
  }
  return { ids, ambiguous: ids.length > 1 };
}

export function parseOrder(value: unknown): NormalizedOrder | null {
  if (!isRecord(value)) return null;
  const idValue = readNumber(value.id);
  const lineList = extractList(value.order_items ?? value.items ?? value.lines ?? value.orderlines ?? value.order_lines, [
    "items",
    "results",
    "order_items",
  ]);
  // extractList on an array returns it; on a non-wrapping value returns [].
  const directLines = Array.isArray(value.order_items)
    ? value.order_items
    : Array.isArray(value.items)
      ? value.items
      : Array.isArray(value.lines)
        ? value.lines
        : Array.isArray(value.orderlines)
          ? value.orderlines
          : Array.isArray(value.order_lines)
            ? value.order_lines
            : lineList;

  const parcelList = Array.isArray(value.parcels)
    ? value.parcels
    : Array.isArray(value.shipments)
      ? value.shipments
      : Array.isArray(value.packages)
        ? value.packages
        : [];

  const parcels = parcelList.map(parseParcel).filter((parcel): parcel is NormalizedParcel => parcel != null);

  if (parcels.length === 0) {
    const track = firstString([value], ["carrier_track", "carrierTrack", "tracking_code", "trackingCode"]);
    const hasPdf = readBool(value.has_pdf ?? value.hasPdf) || Boolean(readString(value.label_id)) || Boolean(readString(value.printed_at));
    if (track) {
      parcels.push({
        createdAt:
          firstString([value], ["parcel_created_at", "shipped_at", "printed_at", "printedAt"]) ??
          readString(value.created_at),
        hasPdf,
        carrierTrack: track,
        carrier: firstString([value], ["carrier", "carrier_name"]),
        packageType: firstString([value], ["package_type", "packageType"]),
        printedAt: readString(value.printed_at),
      });
    }
  }

  const picks = parsePickorders(value);
  return {
    id: idValue != null && Number.isInteger(idValue) ? idValue : null,
    name: readString(value.name) ?? readString(value.order_name),
    status: readString(value.status),
    createdAt: readString(value.created_at) ?? readString(value.createdAt),
    pickorderIds: picks.ids,
    ambiguousPick: picks.ambiguous,
    lines: directLines.map(parseLine).filter((line): line is NormalizedLine => line != null),
    parcels,
  };
}

export function parseOrders(payload: unknown): NormalizedOrder[] {
  return extractList(payload, ["orders", "results", "data"]).map(parseOrder).filter((order): order is NormalizedOrder => order != null);
}

function readOpslag(product: Record<string, unknown>): number | null {
  if ("OPSLAG" in product) return readNumber(product.OPSLAG);
  if ("opslag" in product) return readNumber(product.opslag);
  const stock = product.stock ?? product.stocks ?? product.inventory;
  if (Array.isArray(stock)) {
    for (const row of stock) {
      if (!isRecord(row)) continue;
      const location = String(row.location ?? row.name ?? row.warehouse ?? row.type ?? "").toUpperCase();
      if (location.includes("OPSLAG")) {
        const amount = readNumber(row.quantity ?? row.qty ?? row.stock ?? row.available);
        if (amount != null) return amount;
      }
    }
  }
  return null;
}

export function parseProduct(value: unknown): ParsedProduct | null {
  if (!isRecord(value)) return null;
  const sku = readString(value.sku) ?? readString(value.SKU);
  if (!sku) return null;
  const idValue = readNumber(value.id);
  return {
    id: idValue != null && Number.isInteger(idValue) ? idValue : null,
    sku,
    title: readString(value.title) ?? readString(value.titel) ?? readString(value.name) ?? sku,
    opslag: readOpslag(value),
    updatedStockAt: readString(value.updated_stock_at) ?? readString(value.updatedStockAt),
    isSet: value.is_set === true || value.isSet === true,
  };
}

export function parseProducts(payload: unknown): ParsedProduct[] {
  return extractList(payload, ["products", "results", "data"])
    .map(parseProduct)
    .filter((product): product is ParsedProduct => product != null);
}

export function isTestOrder(order: NormalizedOrder): boolean {
  if (order.status && order.status.toUpperCase() === "DRAFT") return true;
  return Boolean(order.name && /\btest(order|bestelling)?\b/i.test(order.name));
}

export function shippedParcels(order: NormalizedOrder): NormalizedParcel[] {
  return order.parcels.filter((parcel) => parcel.hasPdf && Boolean(parcel.carrierTrack));
}
