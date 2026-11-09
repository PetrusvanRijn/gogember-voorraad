import { TIMEZONE } from "./config";

const integer = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function formatInt(value: number): string {
  return integer.format(Math.round(value));
}

export function formatStock(value: number): string {
  if (Number.isInteger(value)) return integer.format(value);
  return oneDecimal.format(value);
}

export function formatOneDecimal(value: number): string {
  return oneDecimal.format(value);
}

export function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("nl-NL", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("nl-NL", {
    timeZone: TIMEZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function formatDayLabel(ymd: string, withWeekday: boolean): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd ?? "")) return "—";
  const date = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("nl-NL", {
    timeZone: "UTC",
    weekday: withWeekday ? "short" : undefined,
    day: "numeric",
    month: "short",
  }).format(date);
}
