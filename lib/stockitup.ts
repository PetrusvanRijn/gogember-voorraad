import "server-only";

import fs from "fs";
import path from "path";
import { API_BASE, PAGE_SIZE, configuredSellerId, sampleDataEnabled } from "./config";
import { emptyHistory, knownDates, openDates, productsAreFresh, recordBackfillPage, type HistoryStore } from "./history";
import { readHistoryStore, writeHistoryStore, blobConfigured } from "./history-store";
import { collectDailyUsage, replaceOpenDays, buildDashboard, type Dashboard } from "./metrics";
import { paginateDetailed, type Page } from "./paginate";
import { extractList, isRecord, parseOrders, parseProducts, readNumber, type ParsedProduct } from "./parse";
import { isTimeoutError, retryTimeouts, timeoutMessage } from "./siu-retry";
import { reportWindow, startOfJohannesburgDayMs } from "./time";

export class StockitupError extends Error {}

type Row = { id: number | null; raw: Record<string, unknown> };

const PAGE_BUDGET_MS = 14_000;
const CALL_TIMEOUT_MS = 20_000;

export function blobSetupMessage(): string {
  return "Vercel Blob ontbreekt. Maak in het Vercel-project een private Blob store en koppel die aan gogember-voorraad. Op Vercel komt daar BLOB_STORE_ID bij; lokaal zet je BLOB_READ_WRITE_TOKEN.";
}

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

async function siu(pathAndQuery: string, options?: { timeoutMs?: number; retries?: number }): Promise<unknown> {
  const timeoutMs = options?.timeoutMs ?? CALL_TIMEOUT_MS;
  const retries = options?.retries ?? 2;
  let response: Response;
  try {
    response = await retryTimeouts(
      () =>
        fetch(`${API_BASE}${pathAndQuery}`, {
          headers: { Authorization: authHeader(), Accept: "application/json" },
          cache: "no-store",
          signal: AbortSignal.timeout(timeoutMs),
        }),
      undefined,
      retries,
    );
  } catch (error) {
    if (isTimeoutError(error)) throw new StockitupError(timeoutMessage());
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

async function fetchProducts(
  seller: number,
  options: { timeoutMs: number; retries: number; deadlineMs: number },
): Promise<{ payload: unknown; parsed: ParsedProduct[] }> {
  const result = await paginateDetailed(
    (idGt) =>
      siu(`/sellers/${seller}/products/?page_size=${PAGE_SIZE}&id_gt=${idGt}`, {
        timeoutMs: options.timeoutMs,
        retries: options.retries,
      }).then((payload) => toPage(payload, ["products", "results", "data"])),
    { maxPages: 3, deadlineMs: options.deadlineMs },
  );
  if (result.error && result.items.length === 0) throw result.error;
  const payload = { products: result.items.map((row) => row.raw) };
  return { payload, parsed: parseProducts(payload) };
}

function ordersUrl(seller: number, idGt: number, updatedSinceMs: number): string {
  return `/sellers/${seller}/orders/?page_size=${PAGE_SIZE}&id_gt=${idGt}&updated_since=${updatedSinceMs}`;
}

async function fetchOrderPage(
  seller: number,
  updatedSinceMs: number,
  startId: number,
  options: { timeoutMs: number; retries: number; deadlineMs: number },
) {
  return paginateDetailed(
    (idGt) =>
      siu(ordersUrl(seller, idGt, updatedSinceMs), {
        timeoutMs: options.timeoutMs,
        retries: options.retries,
      }).then((payload) => toPage(payload, ["orders", "results", "data"])),
    { startId, maxPages: 1, deadlineMs: options.deadlineMs },
  );
}

function readSample(name: string): unknown {
  const file = path.join(process.cwd(), "data", name);
  return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "unknown";
}

async function loadStore(now: string): Promise<HistoryStore> {
  const stored = await readHistoryStore();
  if (!stored || stored.version !== 1) return emptyHistory(now);
  return stored;
}

async function backfillPages(
  store: HistoryStore,
  products: ParsedProduct[],
  options: { pages: number; deadlineMs: number; timeoutMs: number; retries: number },
): Promise<HistoryStore> {
  const seller = configuredSellerId();
  let pages = 0;
  while (!store.backfillDone && pages < options.pages && Date.now() < options.deadlineMs) {
    const timeoutMs = Math.min(options.timeoutMs, options.deadlineMs - Date.now());
    if (timeoutMs < 1000) break;
    const { yesterday } = openDates(new Date().toISOString());
    const page = await fetchOrderPage(seller, store.backfillSinceMs, store.backfillNextId, {
      timeoutMs,
      retries: options.retries,
      deadlineMs: options.deadlineMs,
    });
    if (page.error) {
      console.error(`StockItUp backfill stopped at id_gt=${store.backfillNextId}: ${errorText(page.error)}`);
      if (page.nextId > store.backfillNextId) {
        store = recordBackfillPage(store, {
          nextId: page.nextId,
          complete: false,
          days: collectDailyUsage(parseOrders({ orders: page.items.map((row) => row.raw) }), products).days,
          openFrom: yesterday,
        });
        await writeHistoryStore(store);
      }
      break;
    }
    store = recordBackfillPage(store, {
      nextId: page.nextId,
      complete: page.complete,
      days: collectDailyUsage(parseOrders({ orders: page.items.map((row) => row.raw) }), products).days,
      openFrom: yesterday,
    });
    await writeHistoryStore(store);
    pages += 1;
    if (page.complete) break;
  }
  return store;
}

async function refreshOpenDays(
  store: HistoryStore,
  products: ParsedProduct[],
  options: { deadlineMs: number; timeoutMs: number; retries: number },
): Promise<HistoryStore> {
  const seller = configuredSellerId();
  const now = new Date().toISOString();
  const { today, yesterday } = openDates(now);
  const rows: Row[] = [];
  let startId = 1;
  while (Date.now() < options.deadlineMs) {
    const timeoutMs = Math.min(options.timeoutMs, options.deadlineMs - Date.now());
    if (timeoutMs < 1000) return store;
    const page = await fetchOrderPage(seller, startOfJohannesburgDayMs(yesterday), startId, {
      timeoutMs,
      retries: options.retries,
      deadlineMs: options.deadlineMs,
    });
    if (page.error) {
      console.error(`StockItUp open-day refresh stopped at id_gt=${startId}: ${errorText(page.error)}`);
      return store;
    }
    rows.push(...page.items);
    if (page.complete) {
      const fresh = collectDailyUsage(parseOrders({ orders: rows.map((row) => row.raw) }), products).days;
      return {
        ...store,
        days: replaceOpenDays(store.days, fresh, [yesterday, today]),
        openRefreshedAt: now,
      };
    }
    startId = page.nextId;
  }
  return store;
}

function dashboardFromStore(
  store: HistoryStore,
  periodDays: number,
  fetchedAt: string,
  stockStale: boolean,
): Dashboard {
  const productsPayload = store.productsPayload ?? { products: [] };
  const dates = knownDates(store, fetchedAt, reportWindow(fetchedAt, periodDays).chartEnd);
  return buildDashboard({
    productsPayload,
    ordersPayload: [],
    daily: store.days,
    periodDays,
    mode: "live",
    fetchedAt: store.productsFetchedAt ?? fetchedAt,
    knownDates: store.backfillDone ? null : dates,
    coverageStart: store.backfillDone ? store.backfillStart : null,
    historyBuilding: !store.backfillDone,
    stockStale,
  });
}

async function loadLive(periodDays: number): Promise<Dashboard> {
  if (!blobConfigured()) throw new StockitupError(blobSetupMessage());
  const fetchedAt = new Date().toISOString();
  const deadline = Date.now() + PAGE_BUDGET_MS;
  const seller = configuredSellerId();
  let store = await loadStore(fetchedAt);
  let stockStale = false;

  if (!productsAreFresh(store)) {
    const timeoutMs = Math.min(CALL_TIMEOUT_MS, deadline - Date.now());
    if (timeoutMs >= 1000) {
      try {
        const products = await fetchProducts(seller, { timeoutMs, retries: 0, deadlineMs: deadline });
        store = { ...store, productsPayload: products.payload, productsFetchedAt: new Date().toISOString() };
        await writeHistoryStore(store);
      } catch (error) {
        console.error(`StockItUp product refresh failed: ${errorText(error)}`);
        stockStale = true;
      }
    } else if (store.productsPayload) {
      stockStale = true;
    }
  }

  if (!store.backfillDone && deadline - Date.now() > 1500) {
    const products = parseProducts(store.productsPayload ?? { products: [] });
    store = await backfillPages(store, products, {
      pages: 1,
      deadlineMs: deadline,
      timeoutMs: CALL_TIMEOUT_MS,
      retries: 0,
    });
  }

  return dashboardFromStore(store, periodDays, fetchedAt, stockStale);
}

export async function refreshHistoryFromCron(): Promise<HistoryStore> {
  if (!blobConfigured()) throw new StockitupError(blobSetupMessage());
  const now = new Date().toISOString();
  const seller = configuredSellerId();
  const deadline = Date.now() + 240_000;
  let store = await loadStore(now);

  try {
    const products = await fetchProducts(seller, { timeoutMs: CALL_TIMEOUT_MS, retries: 2, deadlineMs: deadline });
    store = { ...store, productsPayload: products.payload, productsFetchedAt: new Date().toISOString() };
    await writeHistoryStore(store);
  } catch (error) {
    console.error(`StockItUp product refresh failed during cron: ${errorText(error)}`);
  }

  const parsed = parseProducts(store.productsPayload ?? { products: [] });
  store = await backfillPages(store, parsed, {
    pages: 400,
    deadlineMs: Math.min(deadline, Date.now() + 180_000),
    timeoutMs: CALL_TIMEOUT_MS,
    retries: 2,
  });
  if (Date.now() < deadline) {
    store = await refreshOpenDays(store, parsed, { deadlineMs: deadline, timeoutMs: CALL_TIMEOUT_MS, retries: 2 });
    await writeHistoryStore(store);
  }
  return store;
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
  return loadLive(periodDays);
}

export function getDashboard(periodDays: number): Promise<Dashboard> {
  return load(periodDays, sampleDataEnabled() ? "sample" : "live");
}
