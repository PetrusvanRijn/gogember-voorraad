import "server-only";

import fs from "fs";
import path from "path";
import { unstable_cache } from "next/cache";
import { API_BASE, CACHE_SECONDS, PAGE_SIZE, configuredSellerId, sampleDataEnabled } from "./config";
import { emptyHistory, knownDates, openDates, type HistoryStore } from "./history";
import { readHistoryStore, writeHistoryStore, blobConfigured } from "./history-store";
import { collectDailyUsage, mergeClosedDays, replaceOpenDays, buildDashboard, type Dashboard } from "./metrics";
import { paginate, paginateDetailed, type Page } from "./paginate";
import { extractList, isRecord, parseOrders, parseProducts, readNumber, type ParsedProduct } from "./parse";
import { isTimeoutError, retryTimeouts, timeoutMessage } from "./siu-retry";
import { reportWindow, startOfJohannesburgDayMs } from "./time";

export class StockitupError extends Error {}

type Row = { id: number | null; raw: Record<string, unknown> };

const REQUEST_OPEN_BUDGET_MS = 12_000;
const REQUEST_BACKFILL_BUDGET_MS = 12_000;
const REQUEST_BACKFILL_PAGES = 12;

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

async function siu(pathAndQuery: string): Promise<unknown> {
  let response: Response;
  try {
    response = await retryTimeouts(() =>
      fetch(`${API_BASE}${pathAndQuery}`, {
        headers: { Authorization: authHeader(), Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      }),
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

async function fetchProducts(seller: number): Promise<{ payload: unknown; parsed: ParsedProduct[] }> {
  const rows = await paginate((idGt) =>
    siu(`/sellers/${seller}/products/?page_size=${PAGE_SIZE}&id_gt=${idGt}`).then((payload) =>
      toPage(payload, ["products", "results", "data"]),
    ),
  );
  const payload = { products: rows.map((row) => row.raw) };
  return { payload, parsed: parseProducts(payload) };
}

async function fetchOrders(
  seller: number,
  updatedSinceMs: number,
  options: { startId?: number; maxPages?: number; deadlineMs?: number },
) {
  return paginateDetailed((idGt) =>
    siu(
      `/sellers/${seller}/orders/?page_size=${PAGE_SIZE}&id_gt=${idGt}&updated_since=${updatedSinceMs}`,
    ).then((payload) => toPage(payload, ["orders", "results", "data"])),
    options,
  );
}

function readSample(name: string): unknown {
  const file = path.join(process.cwd(), "data", name);
  return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
}

export type SyncBudgets = {
  openBudgetMs: number;
  backfillBudgetMs: number;
  backfillPages: number;
};

export async function syncHistory(budgets: SyncBudgets): Promise<{
  store: HistoryStore;
  productsPayload: unknown;
  sellerNote: string | null;
  sellerMissing: boolean;
}> {
  if (!blobConfigured()) throw new StockitupError(blobSetupMessage());

  const now = new Date().toISOString();
  const seller = configuredSellerId();
  const { yesterday } = openDates(now);
  let store = (await readHistoryStore()) ?? emptyHistory(now);
  if (store.version !== 1) store = emptyHistory(now);

  const [sellersPayload, productsResult] = await Promise.all([
    siu("/sellers/").catch(() => null),
    fetchProducts(seller),
  ]);
  const products = productsResult.parsed;

  let sellerNote: string | null = null;
  let sellerMissing = false;
  if (sellersPayload) {
    const sellers = extractList(sellersPayload, ["sellers", "results"]).filter(isRecord);
    const match = sellers.find((item) => readNumber(item.id) === seller);
    if (sellers.length > 0 && !match) sellerMissing = true;
    if (match && typeof match.name === "string") sellerNote = match.name;
  }

  const openPromise = fetchOrders(seller, startOfJohannesburgDayMs(yesterday), {
    maxPages: 40,
    deadlineMs: Date.now() + budgets.openBudgetMs,
  }).then(
    (result) => ({ result, error: null as StockitupError | null }),
    (error: unknown) => ({ result: null, error: error instanceof StockitupError ? error : new StockitupError(timeoutMessage()) }),
  );

  const backfillPromise = store.backfillDone
    ? Promise.resolve(null)
    : fetchOrders(seller, store.backfillSinceMs, {
        startId: store.backfillNextId,
        maxPages: budgets.backfillPages,
        deadlineMs: Date.now() + budgets.backfillBudgetMs,
      }).then(
        (result) => ({ result, error: null as StockitupError | null }),
        (error: unknown) => ({ result: null, error: error instanceof StockitupError ? error : new StockitupError(timeoutMessage()) }),
      );

  const [open, backfill] = await Promise.all([openPromise, backfillPromise]);

  if (backfill?.result) {
    const extra = collectDailyUsage(
      parseOrders({ orders: backfill.result.items.map((row) => row.raw) }),
      products,
    ).days;
    store = {
      ...store,
      days: mergeClosedDays(store.days, extra, yesterday),
      backfillNextId: backfill.result.nextId,
      backfillDone: backfill.result.complete,
    };
  }

  if (open.result?.complete) {
    const fresh = collectDailyUsage(
      parseOrders({ orders: open.result.items.map((row) => row.raw) }),
      products,
    ).days;
    store = {
      ...store,
      days: replaceOpenDays(store.days, fresh, [yesterday, openDates(now).today]),
      openRefreshedAt: now,
    };
  }

  const nothingStored = !store.openRefreshedAt && Object.keys(store.days).length === 0 && !store.backfillDone;
  if (nothingStored && open.error) throw open.error;

  await writeHistoryStore(store);
  return { store, productsPayload: productsResult.payload, sellerNote, sellerMissing };
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

  const { store, productsPayload, sellerNote, sellerMissing } = await syncHistory({
    openBudgetMs: REQUEST_OPEN_BUDGET_MS,
    backfillBudgetMs: REQUEST_BACKFILL_BUDGET_MS,
    backfillPages: REQUEST_BACKFILL_PAGES,
  });
  const dates = knownDates(store, fetchedAt, reportWindow(fetchedAt, periodDays).chartEnd);
  return buildDashboard({
    productsPayload,
    ordersPayload: [],
    daily: store.days,
    periodDays,
    mode,
    fetchedAt,
    knownDates: store.backfillDone ? null : dates,
    coverageStart: store.backfillDone ? store.backfillStart : null,
    historyBuilding: !store.backfillDone,
    sellerNote,
    sellerMissing,
  });
}

export async function refreshHistoryFromCron(): Promise<HistoryStore> {
  const { store } = await syncHistory({
    openBudgetMs: 45_000,
    backfillBudgetMs: 200_000,
    backfillPages: 400,
  });
  return store;
}

const cachedLoad = unstable_cache(load, ["gogember-voorraad-v4"], { revalidate: CACHE_SECONDS });

export function getDashboard(periodDays: number): Promise<Dashboard> {
  return cachedLoad(periodDays, sampleDataEnabled() ? "sample" : "live");
}
