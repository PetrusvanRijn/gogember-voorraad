import { COMPLETE_DAY_HOUR, TIMEZONE } from "./config";

const formatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function johannesburgParts(iso: string): { date: string; minutes: number } {
  const map: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(iso))) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  let hour = Number(map.hour);
  if (hour === 24) hour = 0;
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    minutes: hour * 60 + Number(map.minute),
  };
}

export function johannesburgDate(iso: string): string {
  return johannesburgParts(iso).date;
}

export function addDays(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function daysBetween(start: string, end: string): string[] {
  if (!start || !end || end < start) return [];
  const days: string[] = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    days.push(cursor);
  }
  return days;
}

/** Midnight at the start of a Johannesburg calendar day, as epoch milliseconds. */
export function startOfJohannesburgDayMs(ymd: string): number {
  const [year, month, day] = ymd.split("-").map(Number);
  return Date.UTC(year, month - 1, day, -2, 0, 0, 0);
}

export function isPartialInstant(iso: string): boolean {
  return johannesburgParts(iso).minutes < COMPLETE_DAY_HOUR * 60;
}

export type ReportWindow = {
  /** First day included in the average. */
  start: string;
  /** Last complete day included in the average. */
  end: string;
  /** Last day drawn on the chart. Equals `end` when the anchor day is complete. */
  chartEnd: string;
  partialDate: string | null;
};

export function reportWindow(anchorIso: string, periodDays: number): ReportWindow {
  const anchor = johannesburgParts(anchorIso);
  const partial = anchor.minutes < COMPLETE_DAY_HOUR * 60;
  const end = partial ? addDays(anchor.date, -1) : anchor.date;
  return {
    start: addDays(end, -(periodDays - 1)),
    end,
    chartEnd: partial ? anchor.date : end,
    partialDate: partial ? anchor.date : null,
  };
}
