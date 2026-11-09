import "server-only";

import fs from "fs";
import path from "path";
import { unstable_cache } from "next/cache";
import { API_BASE, CACHE_SECONDS, PAGE_SIZE, configuredSellerId, sampleDataEnabled } from "./config";
import { buildDashboard, type Dashboard } from "./metrics";
import { paginate, type Page } from "./paginate";
import { extractList, isRecord, readNumber } from "./parse";
import { addDays, reportWindow, startOfJohannesburgDayMs } from "./time";

export class StockitupError extends Error {}

type Row = { id: number | null; raw: Record<string, unknown> };

function authHeader(): string {
  const id = process.env.GOGEMBER_STOCKITUP_CLIENT_ID ?? "";
  const secret = process.env.GOGEMBER_STOCKITUP_CLIENT_SECRET ?? "";
  if (!id || !secret) {
    throw new StockitupError(
      "StockItUp-inloggegevens ontbreken. Zet de client-id en het client-secret, of zet USE_SAMPLE_DATA=1.",
    );
  }
  return `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
}

async function siu(pathAndQuery: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${pathAndQuery}`, {
      headers: { Authorization: authHeader(), Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new StockitupError("StockItUp is niet bereikbaar. Probeer het over een paar minuten opnieuw.");
  }
  if (!response.ok) {
    const body = (await response.text()).replace(/\s+/g, " ").slice(0, 180);
    throw new StockitupError(`StockItUp antwoordde ${response.status} op ${pathAndQuery.split("?")[0]}. ${body}`);
  }
  return response.json() as Promise<unknown>;
}

function toPage(payload: unknown, listKeys: string[]): Page<Row> {
  const items = extractList(payload, listKeys)
    .filter(isRecord)
    .map((raw) => {
      const id = readNumber(raw.id);
      return { id: id != null && Number.isInteger(id) ? id : null, raw };
    });
  const record = isRecord(payload) ? payload : {};
  const next = readNumber(record.next_id_gt);
  return {
    items,
    hasNext: typeof record.has_next === "boolean" ? record.has_next : undefined,
    nextId: next != null && Number.isInteger(next) ? next : null,
  };
}

async function fetchProducts(seller: number): Promise<unknown[]> {
  const rows = await paginate((idGt) =>
    siu(`/sellers/${seller}/products/?page_size=${PAGE_SIZE}&id_gt=${idGt}`).then((payload) =>
      toPage(payload, ["products", "results", "data"]),
    ),
  );
  return rows.map((row) => row.raw);
}

async function fetchOrders(seller: number, updatedSinceMs: number): Promise<unknown[]> {
  // updated_since, not created_since: a parcel in this window often belongs to an
  // order that was placed earlier. Sending both would hide those orders if the API
  // combines the filters.
  const rows = await paginate((idGt) =>
    siu(
      `/sellers/${seller}/orders/?page_size=${PAGE_SIZE}&id_gt=${idGt}&updated_since=${updatedSinceMs}`,
    ).then((payload) => toPage(payload, ["orders", "results", "data"])),
  );
  return rows.map((row) => row.raw);
}

function readSample(name: string): unknown {
  const file = path.join(process.cwd(), "data", name);
  return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
}

async function load(periodDays: number, mode: "sample" | "live"): Promise<Dashboard> {
  const fetchedAt = new Date().toISOString();
  if (mode === "sample") {
    return buildDashboard({
      productsPayload: readSample("sample-products.json"),
      ordersPayload: readSample("sample-orders.json"),
      periodDays,
      mode,
      fetchedAt,
    });
  }

  const seller = configuredSellerId();
  const window = reportWindow(fetchedAt, periodDays);
  const fetchFrom = addDays(window.start, -1);
  const sinceMs = startOfJohannesburgDayMs(fetchFrom);

  const [sellersPayload, products, orders] = await Promise.all([
    siu("/sellers/").catch(() => null),
    fetchProducts(seller),
    fetchOrders(seller, sinceMs),
  ]);

  let sellerNote: string | null = null;
  let sellerMissing = false;
  if (sellersPayload) {
    const sellers = extractList(sellersPayload, ["sellers", "results"]).filter(isRecord);
    const match = sellers.find((item) => readNumber(item.id) === seller);
    if (sellers.length > 0 && !match) sellerMissing = true;
    if (match && typeof match.name === "string") sellerNote = match.name;
  }

  return buildDashboard({
    productsPayload: { products },
    ordersPayload: { orders },
    periodDays,
    mode,
    fetchedAt,
    coverageStart: fetchFrom,
    sellerNote,
    sellerMissing,
  });
}

const cachedLoad = unstable_cache(load, ["gogember-voorraad-v3"], { revalidate: CACHE_SECONDS });

export function getDashboard(periodDays: number): Promise<Dashboard> {
  return cachedLoad(periodDays, sampleDataEnabled() ? "sample" : "live");
}
