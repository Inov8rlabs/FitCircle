/** Calendar-day helpers for the ads console (YYYY-MM-DD strings, time-zone aware). */

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export const isYmd = (v: unknown): v is string => typeof v === 'string' && YMD.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function diffDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end && out.length < 1000; d = addDays(d, 1)) out.push(d);
  return out;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    fmtCache.set(tz, f);
  }
  return f;
}

/** The calendar date of an instant in a time zone. */
export function ymdInTz(instant: string | number | Date, tz: string): string {
  const d = instant instanceof Date ? instant : new Date(instant);
  return fmt(tz).format(d);
}

export const todayInTz = (tz: string, now: Date = new Date()) => ymdInTz(now, tz);
