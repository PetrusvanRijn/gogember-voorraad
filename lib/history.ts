import { addDays, johannesburgDate, reportWindow, startOfJohannesburgDayMs } from "./time";
import type { DailyTracks } from "./metrics";

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
