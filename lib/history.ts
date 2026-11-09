import { mergeClosedDays, type DailyTracks } from "./metrics";
import { addDays, johannesburgDate, reportWindow, startOfJohannesburgDayMs } from "./time";

export const HISTORY_VERSION = 1;
export const HALF_YEAR_DAYS = 182;

export type HistoryStore = {
  version: typeof HISTORY_VERSION;
  days: DailyTracks;
  backfillNextId: number;
  backfillDone: boolean;
  /** First Johannesburg day the historical scan is responsible for. */
  backfillStart: string;
  backfillSinceMs: number;
  openRefreshedAt: string | null;
  /** Raw StockItUp product payload, kept so a failed refresh can still show stock. */
  productsPayload?: unknown;
  productsFetchedAt?: string | null;
};

export function emptyHistory(nowIso: string): HistoryStore {
  const window = reportWindow(nowIso, HALF_YEAR_DAYS);
  const backfillStart = addDays(window.start, -2);
  return {
    version: HISTORY_VERSION,
    days: {},
    backfillNextId: 1,
    backfillDone: false,
    backfillStart,
    backfillSinceMs: startOfJohannesburgDayMs(backfillStart),
    openRefreshedAt: null,
    productsPayload: null,
    productsFetchedAt: null,
  };
}

const PRODUCT_CACHE_MS = 10 * 60 * 1000;

export function productsAreFresh(store: HistoryStore, nowMs = Date.now()): boolean {
  if (!store.productsPayload || !store.productsFetchedAt) return false;
  const fetched = new Date(store.productsFetchedAt).getTime();
  return Number.isFinite(fetched) && nowMs - fetched < PRODUCT_CACHE_MS;
}

/** Apply one successful backfill page. A later failure must not move the cursor backwards. */
export function recordBackfillPage(
  store: HistoryStore,
  input: { nextId: number; complete: boolean; days: DailyTracks; openFrom: string },
): HistoryStore {
  return {
    ...store,
    days: mergeClosedDays(store.days, input.days, input.openFrom),
    backfillNextId: Math.max(store.backfillNextId, input.nextId),
    backfillDone: store.backfillDone || input.complete,
  };
}

export function openDates(nowIso: string): { today: string; yesterday: string } {
  const today = johannesburgDate(nowIso);
  return { today, yesterday: addDays(today, -1) };
}

/** Days the dashboard may treat as complete, including real zeros. */
export function knownDates(store: HistoryStore, nowIso: string, through: string): string[] {
  const { today, yesterday } = openDates(nowIso);
  const dates: string[] = [];
  if (store.openRefreshedAt) {
    if (yesterday <= through) dates.push(yesterday);
    if (today <= through) dates.push(today);
  }
  if (store.backfillDone) {
    for (let cursor = store.backfillStart; cursor <= through; cursor = addDays(cursor, 1)) {
      if (!dates.includes(cursor)) dates.push(cursor);
    }
  }
  return dates;
}
