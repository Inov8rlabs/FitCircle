/** Display helpers for the ads console. Null / non-finite → "—". */

const DASH = '—';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const int = new Intl.NumberFormat('en-US');

const ok = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

export const money = (v: number | null | undefined, compact = false) => (ok(v) ? (compact && Math.abs(v) >= 1000 ? usd0.format(v) : usd.format(v)) : DASH);
export const count = (v: number | null | undefined) => (ok(v) ? int.format(v) : DASH);
export const pct = (v: number | null | undefined, digits = 0) => (ok(v) ? `${(v * 100).toFixed(digits)}%` : DASH);
export const signedPct = (v: number | null | undefined) => (ok(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(0)}%` : DASH);

export function relTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'never';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export const shortDay = (ymd: string) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
};

export const dateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : DASH;

export const STRATEGY_LABEL: Record<string, string> = {
  MANUAL_CPT: 'Manual CPT',
  MAXIMIZE_CONVERSIONS: 'Maximize conversions',
  COST_PER_INSTALL: 'Target CPI',
  LOWEST_COST_WITHOUT_CAP: 'Lowest cost',
  LOWEST_COST_WITH_BID_CAP: 'Bid cap',
  COST_CAP: 'Cost cap',
  LOWEST_COST_WITH_MIN_ROAS: 'Min ROAS',
};

export const strategyLabel = (s: string | null | undefined) => (s ? (STRATEGY_LABEL[s] ?? s.replace(/_/g, ' ').toLowerCase()) : DASH);
