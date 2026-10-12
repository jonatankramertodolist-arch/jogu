/**
 * All dates in the app are plain ISO day strings (YYYY-MM-DD) handled in local
 * time. Using strings avoids the timezone drift you get when Date objects are
 * serialised, which matters because a training day must never shift.
 */

const MS_PER_DAY = 86_400_000;

export function todayIso(): string {
  return toIso(new Date());
}

export function toIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function fromIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso: string, days: number): string {
  const date = fromIso(iso);
  date.setDate(date.getDate() + days);
  return toIso(date);
}

export function daysBetween(fromIsoDate: string, toIsoDate: string): number {
  const a = fromIso(fromIsoDate).getTime();
  const b = fromIso(toIsoDate).getTime();
  return Math.round((b - a) / MS_PER_DAY);
}

/** ISO weekday, 1 = Monday .. 7 = Sunday. */
export function isoWeekday(iso: string): number {
  const day = fromIso(iso).getDay();
  return day === 0 ? 7 : day;
}

/** Monday of the week the given date falls in. */
export function startOfWeek(iso: string): string {
  return addDays(iso, -(isoWeekday(iso) - 1));
}

export function isBefore(a: string, b: string): boolean {
  return a < b;
}

export function isAfter(a: string, b: string): boolean {
  return a > b;
}

export function clampIso(iso: string, min: string, max: string): string {
  if (iso < min) return min;
  if (iso > max) return max;
  return iso;
}

const WEEKDAY_SHORT = ['mån', 'tis', 'ons', 'tor', 'fre', 'lör', 'sön'];
const WEEKDAY_LONG = [
  'måndag',
  'tisdag',
  'onsdag',
  'torsdag',
  'fredag',
  'lördag',
  'söndag',
];
const MONTHS = [
  'januari',
  'februari',
  'mars',
  'april',
  'maj',
  'juni',
  'juli',
  'augusti',
  'september',
  'oktober',
  'november',
  'december',
];
const MONTHS_SHORT = [
  'jan',
  'feb',
  'mar',
  'apr',
  'maj',
  'jun',
  'jul',
  'aug',
  'sep',
  'okt',
  'nov',
  'dec',
];

export function weekdayShort(iso: string): string {
  return WEEKDAY_SHORT[isoWeekday(iso) - 1];
}

export function weekdayLong(iso: string): string {
  return WEEKDAY_LONG[isoWeekday(iso) - 1];
}

export function weekdayNameFromNumber(isoDay: number): string {
  return WEEKDAY_LONG[isoDay - 1] ?? '';
}

export function weekdayShortFromNumber(isoDay: number): string {
  return WEEKDAY_SHORT[isoDay - 1] ?? '';
}

/** "12 mars" */
export function formatDayMonth(iso: string): string {
  const date = fromIso(iso);
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/** "12 mar" */
export function formatDayMonthShort(iso: string): string {
  const date = fromIso(iso);
  return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`;
}

/** "lördag 12 mars" */
export function formatWeekdayDate(iso: string): string {
  return `${weekdayLong(iso)} ${formatDayMonth(iso)}`;
}

/** "12 mars 2027" */
export function formatFullDate(iso: string): string {
  return `${formatDayMonth(iso)} ${fromIso(iso).getFullYear()}`;
}

/** "10 mar – 16 mar" */
export function formatWeekRange(weekStart: string): string {
  return `${formatDayMonthShort(weekStart)} – ${formatDayMonthShort(addDays(weekStart, 6))}`;
}

export function relativeDayLabel(iso: string, today = todayIso()): string {
  const diff = daysBetween(today, iso);
  if (diff === 0) return 'Idag';
  if (diff === 1) return 'Imorgon';
  if (diff === -1) return 'Igår';
  return formatWeekdayDate(iso);
}

/** Every date from `from` to `to` inclusive. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

export function formatDuration(minutes: number): string {
  const rounded = Math.round(minutes);
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

export function formatHours(hours: number): string {
  const rounded = Math.round(hours * 10) / 10;
  return `${rounded.toString().replace('.', ',')} h`;
}
