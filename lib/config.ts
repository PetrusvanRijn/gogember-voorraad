export const SELLER_ID = 38;

export const TIMEZONE = "Africa/Johannesburg";

/** Days of cover below this are red. */
export const RED_BELOW_DAYS = 14;

/** Days of cover below this (and at or above the red line) are orange. */
export const ORANGE_BELOW_DAYS = 30;

/**
 * Box 6 is in use from this Johannesburg date onward.
 * Before that, 1–12 bottles ship in box 12.
 */
export const BOX6_SINCE = "2026-11-05";

/** A Johannesburg day that has not reached this hour is left out of the average. */
export const COMPLETE_DAY_HOUR = 18;

export const CACHE_SECONDS = 15 * 60;

export const PAGE_SIZE = 100;

export const API_BASE = "https://his.stockitup.nl/api/v1";

export const PERIODS = [
  { id: "7", days: 7, label: "7 dagen" },
  { id: "28", days: 28, label: "28 dagen" },
  { id: "182", days: 182, label: "Half jaar" },
] as const;

export type Period = (typeof PERIODS)[number];

export function resolvePeriod(raw: string | undefined): Period {
  return PERIODS.find((period) => period.id === raw) ?? PERIODS[0];
}

export function sampleDataEnabled(): boolean {
  const value = (process.env.USE_SAMPLE_DATA ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export function configuredSellerId(): number {
  const raw = process.env.GOGEMBER_STOCKITUP_SELLER_ID;
  const parsed = raw ? Number(raw) : SELLER_ID;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : SELLER_ID;
}
