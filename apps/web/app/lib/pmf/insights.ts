/**
 * Rule-based, plain-English insights from the computed KPIs. PURE and deterministic (no LLM): every sentence is
 * derived from numbers in the KPI rows and cites them.
 *
 * Rules, in display order:
 *  1. score     PMF score (or why it cannot be computed) + which measured component is weakest.
 *  2. gate      Growth-plan §4 gates per paid channel (cost per activated ≤ $25, D7 ≥ 20%, trial start ≥ 15%).
 *  3. gap       The rate / money KPIs furthest from target (scale KPIs like DAU are summarised once).
 *  4. mover     Period-over-period changes: two-proportion z-test for rates (|z| ≥ 1.96 = real), ≥ 25% change for
 *               other units with n ≥ 10 each side. "Why": platform / channel mix decomposition when the segments
 *               explain the move.
 *  5. segment   iOS vs Android (and channel) gaps ≥ 15 points with n ≥ 10 on both sides.
 *  6. win       KPIs on track.
 *  7. sample    Small-sample caveat.
 *  8. coverage  KPIs we do not measure.
 */
import { KPI_BY_ID, LOW_SAMPLE_N } from './catalog';
import { CHANNEL_LABEL } from './scorecard';
import type { KpiSegments, KpiUnit, PmfInsight, PmfKpi, PmfScore } from './types';

const MIN_SEGMENT_N = 10;
/** KPI notes starting with this mark a measurement change inside the compared windows (cited by movers). */
export const SIGNAL_NOTE_PREFIX = 'Signal change:';
const MIN_MOVER_N = 10;

export function fmtValue(v: number | null, unit: KpiUnit): string {
  if (v === null) return '—';
  switch (unit) {
    case 'percent':
      return `${round1(v)}%`;
    case 'usd':
      return `$${v.toFixed(2)}`;
    case 'hours':
      return v < 1 ? `${Math.round(v * 60)} min` : `${round1(v)} h`;
    case 'days_per_week':
      return `${round1(v)} days/wk`;
    case 'count':
      return Math.round(v).toLocaleString('en-US');
    case 'ratio':
      return v.toFixed(2);
    default:
      return String(round1(v));
  }
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const pts = (v: number) => `${v > 0 ? '+' : ''}${round1(v)} pts`;
const nOf = (k: PmfKpi, n = k.current.n) => `n=${n}`;
const valN = (k: PmfKpi, v = k.current.value, n = k.current.n, numerator = k.current.numerator) =>
  `${fmtValue(v, k.unit)} (${k.unit === 'percent' && numerator !== null ? `${numerator} of ${n}` : nOf(k, n)})`;

/** Two-proportion z statistic (pooled). */
export function zTwoProportions(x1: number, n1: number, x2: number, n2: number): number | null {
  if (n1 <= 0 || n2 <= 0) return null;
  const p = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (se === 0) return null;
  return (x1 / n1 - x2 / n2) / se;
}

/** How far a KPI is from target as a ratio (1 = on target, smaller = worse). */
export function attainment(k: PmfKpi): number | null {
  const t = k.threshold;
  const v = k.current.value;
  if (!t || v === null) return null;
  if (t.direction === 'higher') return t.target > 0 ? v / t.target : null;
  return v > 0 ? t.target / v : null;
}

/**
 * Mix vs rate decomposition of a rate change across one segment dimension:
 * mix = Σ (share_cur − share_prev) × rate_prev, rate = Σ share_cur × (rate_cur − rate_prev).
 */
export function decompose(seg: KpiSegments): { mix: number; rate: number; driver: { label: string; shareFrom: number; shareTo: number; rate: number | null } | null } | null {
  const rows = seg.rows.filter((r) => r.n > 0 && r.previous.n > 0 && r.value !== null && r.previous.value !== null);
  const nCur = seg.rows.reduce((s, r) => s + r.n, 0);
  const nPrev = seg.rows.reduce((s, r) => s + r.previous.n, 0);
  if (rows.length < 2 || !nCur || !nPrev) return null;
  let mix = 0;
  let rate = 0;
  let driver: { label: string; shareFrom: number; shareTo: number; rate: number | null; effect: number } | null = null;
  for (const r of rows) {
    const sc = r.n / nCur;
    const sp = r.previous.n / nPrev;
    const effect = (sc - sp) * (r.previous.value as number);
    mix += effect;
    rate += sc * ((r.value as number) - (r.previous.value as number));
    if (!driver || Math.abs(sc - sp) > Math.abs(driver.shareTo - driver.shareFrom)) driver = { label: r.label, shareFrom: sp * 100, shareTo: sc * 100, rate: r.previous.value, effect };
  }
  return { mix, rate, driver };
}

function actionOf(id: string): string | null {
  return KPI_BY_ID.get(id)?.action || null;
}

export function buildInsights(kpis: PmfKpi[], score: PmfScore): PmfInsight[] {
  const out: PmfInsight[] = [];
  const by = new Map(kpis.map((k) => [k.id, k]));
  const measured = kpis.filter((k) => k.status !== 'not_measured');

  // 1. PMF score -----------------------------------------------------------
  const scored = score.components.filter((c) => c.score !== null);
  const weakest = [...scored].sort((a, b) => (a.score ?? 0) - (b.score ?? 0))[0];
  if (score.value !== null) {
    out.push({
      id: 'score',
      kind: 'score',
      severity: score.value <= 40 ? 'critical' : score.value <= 60 ? 'warning' : 'positive',
      title: `PMF score ${score.value} — ${score.band}`,
      body: `Weighted from ${score.components.map((c) => `${c.label} ${c.score}`).join(', ')}.${weakest ? ` Weakest: ${weakest.label} (${weakest.score}).` : ''}`,
      action: weakest ? actionOf(weakest.kpiId) : null,
      kpiIds: score.components.map((c) => c.kpiId),
      evidence: score.components.map((c) => `${c.label}: ${c.formula} = ${c.score}`),
    });
  } else {
    out.push({
      id: 'score',
      kind: 'score',
      severity: 'warning',
      title: 'PMF score can’t be computed yet',
      body: `Missing: ${score.missing.join(', ')}. We don’t fill gaps with estimates.${
        scored.length ? ` Measured components: ${scored.map((c) => `${c.label} ${c.score}/100`).join(', ')}${weakest ? ` — ${weakest.label} is weakest` : ''}.` : ''
      }`,
      action: score.missing.includes('Satisfaction')
        ? 'Add an in-app NPS + Sean Ellis question (stored server-side) so Satisfaction (15% of the score) can be measured.'
        : 'Wait for the missing components to mature (see each KPI’s window).',
      kpiIds: score.components.map((c) => c.kpiId),
      evidence: score.components.map((c) => `${c.label} (${Math.round(c.weight * 100)}%): ${c.score === null ? 'not available' : `${c.formula} = ${c.score}`}`),
    });
  }

  // 2. Growth-plan gates per paid channel -------------------------------------
  const cpa = by.get('cost_per_activated');
  const d7 = by.get('d7_retention');
  const trial = by.get('trial_start_rate');
  const channels = new Set<string>();
  for (const k of [cpa, d7, trial]) for (const s of k?.segments ?? []) if (s.dimension === 'channel') for (const r of s.rows) if (['apple_ads', 'google_ads', 'meta'].includes(r.key)) channels.add(r.key);
  for (const ch of channels) {
    const row = (k: PmfKpi | undefined) => k?.segments.find((s) => s.dimension === 'channel')?.rows.find((r) => r.key === ch);
    const c = row(cpa);
    const r7 = row(d7);
    const tr = row(trial);
    if (!c && !r7 && !tr) continue;
    const checks: Array<{ label: string; pass: boolean | null; text: string }> = [
      {
        label: 'Cost per activated ≤ $25',
        pass: c ? (c.value === null ? ((c.numerator ?? 0) > 0 ? false : null) : c.value <= 25) : null,
        text: c ? (c.value === null ? ((c.numerator ?? 0) > 0 ? `$${(c.numerator ?? 0).toFixed(2)} spent, 0 activated` : 'no spend') : `$${c.value.toFixed(2)} (${c.n} activated)`) : 'no data',
      },
      { label: 'D7 ≥ 20%', pass: r7 && r7.value !== null && r7.n >= 1 ? r7.value >= 20 : null, text: r7 && r7.value !== null ? `${r7.value}% (${r7.numerator} of ${r7.n})` : 'not mature yet' },
      { label: 'Trial start ≥ 15% of activated', pass: tr && tr.value !== null ? tr.value >= 15 : null, text: tr && tr.value !== null ? `${tr.value}% (${tr.numerator} of ${tr.n})` : 'no activated users yet' },
    ];
    const failed = checks.filter((x) => x.pass === false);
    const unknown = checks.filter((x) => x.pass === null);
    const small = Math.min(...[c?.n, r7?.n, tr?.n].filter((x): x is number => typeof x === 'number')) < LOW_SAMPLE_N;
    const name = CHANNEL_LABEL[ch] ?? ch;
    out.push({
      id: `gate-${ch}`,
      kind: 'gate',
      severity: failed.length ? 'critical' : unknown.length ? 'info' : 'positive',
      title: failed.length
        ? `${name} does not clear the scale gate (${failed.length} of 3 failing)`
        : unknown.length
          ? `${name}: scale gate not decidable yet`
          : `${name} clears all three scale gates`,
      body: `${checks.map((x) => `${x.label}: ${x.text}${x.pass === null ? '' : x.pass ? ' ✓' : ' ✗'}`).join(' · ')}.${small ? ' Small samples — one user moves these a lot.' : ''}`,
      action: failed.length ? actionOf('cost_per_activated') : unknown.length ? 'Keep spend flat until each check has data.' : 'This channel may be scaled per the growth plan (up to 3× in early January).',
      kpiIds: ['cost_per_activated', 'd7_retention', 'trial_start_rate'],
      evidence: checks.map((x) => `${x.label}: ${x.text}`),
    });
  }

  // 3. Furthest from target ----------------------------------------------------
  const gaps = measured
    .filter((k) => (k.status === 'off_track' || k.status === 'at_risk') && k.unit !== 'count')
    .map((k) => ({ k, a: attainment(k) ?? 0 }))
    .sort((x, y) => x.a - y.a)
    .slice(0, 3);
  for (const { k, a } of gaps) {
    const t = k.threshold!;
    const share = k.current.value === null ? '' : ` — ${Math.round(a * 100)}% of target`;
    out.push({
      id: `gap-${k.id}`,
      kind: 'gap',
      severity: k.status === 'off_track' ? 'critical' : 'warning',
      title: `${k.name} is ${k.status === 'off_track' ? 'off track' : 'at risk'}: ${fmtValue(k.current.value, k.unit)} vs ${t.direction === 'lower' ? '≤ ' : ''}${fmtValue(t.target, k.unit)} target${share}`,
      body: `${k.windowLabel}: ${k.current.value === null ? `no value (${k.unit === 'usd' ? `$${(k.current.numerator ?? 0).toFixed(2)} spent with no ${k.id === 'cost_per_activated' ? 'activated users' : 'users'}` : 'no data'})` : valN(k)}. Threshold from ${t.sourceLabel}.${
        k.lowSample ? ` Only ${k.current.n} users — treat as direction, not truth.` : ''
      }`,
      action: actionOf(k.id),
      kpiIds: [k.id],
      evidence: [`Current ${valN(k)}`, `Target ${fmtValue(t.target, k.unit)}${t.minimum !== null ? `, minimum ${fmtValue(t.minimum, k.unit)}` : ''}`],
    });
  }
  const scale = measured.filter((k) => k.unit === 'count' && k.threshold && k.status === 'off_track');
  if (scale.length) {
    out.push({
      id: 'gap-scale',
      kind: 'gap',
      severity: 'info',
      title: 'Scale is far below the doc’s user targets (expected this early)',
      body: scale.map((k) => `${k.name} ${fmtValue(k.current.value, k.unit)} vs ${fmtValue(k.threshold!.target, k.unit)} target`).join(' · ') + '. Scale is an output of acquisition × retention; fix the rate KPIs first.',
      action: 'Grow only after retention and the paid gates hold (growth plan: spend increases only when a channel clears §4).',
      kpiIds: scale.map((k) => k.id),
      evidence: scale.map((k) => `${k.name}: ${fmtValue(k.current.value, k.unit)}`),
    });
  }

  // 4. Movers --------------------------------------------------------------------
  const movers: Array<{ k: PmfKpi; strength: number; insight: PmfInsight }> = [];
  for (const k of measured) {
    const c = k.current;
    const p = k.previous;
    if (c.value === null || p.value === null || k.change === null) continue;
    let significant: boolean;
    let strength: number;
    let stat: string;
    if (k.unit === 'percent' && c.numerator !== null && p.numerator !== null && !['stickiness'].includes(k.id)) {
      if (c.n < MIN_MOVER_N || p.n < MIN_MOVER_N) continue;
      const z = zTwoProportions(c.numerator, c.n, p.numerator, p.n);
      if (z === null || Math.abs(k.change) < 3) continue;
      significant = Math.abs(z) >= 1.96;
      strength = Math.abs(z);
      stat = `z = ${z.toFixed(2)}${significant ? ', statistically significant (95%)' : ', within noise at this sample size'}`;
    } else {
      if (c.n < MIN_MOVER_N || p.n < MIN_MOVER_N || p.value === 0) continue;
      const rel = (c.value - p.value) / Math.abs(p.value);
      if (Math.abs(rel) < 0.25) continue;
      significant = false;
      strength = Math.abs(rel);
      stat = `${rel > 0 ? '+' : ''}${Math.round(rel * 100)}% vs previous period (no significance test for this unit)`;
    }
    const better = k.threshold ? (k.threshold.direction === 'higher' ? k.change > 0 : k.change < 0) : null;
    const why = k.unit === 'percent' ? explainMove(k) : null;
    const signal = k.notes.find((n) => n.startsWith(SIGNAL_NOTE_PREFIX)) ?? null;
    const changeText = k.unit === 'percent' ? `${round1(Math.abs(k.change))} pts` : fmtValue(Math.abs(k.change), k.unit);
    const isRate = k.unit === 'percent' && c.numerator !== null;
    movers.push({
      k,
      strength: significant ? strength + 100 : strength,
      insight: {
        id: `mover-${k.id}`,
        kind: 'mover',
        severity: signal || better === null ? 'info' : better ? (significant ? 'positive' : 'info') : significant ? 'critical' : 'warning',
        title: `${k.name} ${k.change > 0 ? 'rose' : 'fell'} ${changeText}: ${fmtValue(p.value, k.unit)} → ${fmtValue(c.value, k.unit)}${isRate && !significant ? ' (not significant yet)' : ''}`,
        body: `Previous ${valN(k, p.value, p.n, p.numerator)} → current ${valN(k)}; ${stat}.${why ? ` ${why}` : ''}${signal ? ` ${signal}` : ''}`,
        action: better === false ? actionOf(k.id) : null,
        kpiIds: [k.id],
        evidence: [`Previous: ${valN(k, p.value, p.n, p.numerator)}`, `Current: ${valN(k)}`, stat],
      },
    });
  }
  out.push(...movers.sort((a, b) => b.strength - a.strength).slice(0, 4).map((m) => m.insight));

  // 5. Segment gaps -------------------------------------------------------------
  const segInsights: Array<{ diff: number; insight: PmfInsight }> = [];
  for (const k of measured) {
    if (k.unit !== 'percent') continue;
    for (const seg of k.segments) {
      const rows = seg.rows.filter((r) => r.value !== null && r.n >= MIN_SEGMENT_N && r.key !== 'unknown');
      if (rows.length < 2) continue;
      const sorted = [...rows].sort((a, b) => (b.value as number) - (a.value as number));
      const hi = sorted[0];
      const lo = sorted[sorted.length - 1];
      const diff = (hi.value as number) - (lo.value as number);
      if (diff < 15) continue;
      const higherBetter = k.threshold?.direction !== 'lower';
      const weak = higherBetter ? lo : hi;
      const strong = higherBetter ? hi : lo;
      const z = zTwoProportions(hi.numerator ?? 0, hi.n, lo.numerator ?? 0, lo.n);
      const sig = z !== null && Math.abs(z) >= 1.96;
      const androidNote =
        k.id === 'onboarding_completion' && seg.dimension === 'platform' && weak.key === 'android' ? ' Growth plan 0.2 wants Android within 15 points of iOS.' : '';
      segInsights.push({
        diff,
        insight: {
          id: `segment-${k.id}-${seg.dimension}`,
          kind: 'segment',
          severity: sig ? 'warning' : 'info',
          title: `${k.name}: ${weak.label} ${weak.value}% vs ${strong.label} ${strong.value}% (${pts((weak.value as number) - (strong.value as number))})`,
          body: `${weak.label} ${weak.numerator} of ${weak.n} vs ${strong.label} ${strong.numerator} of ${strong.n}${z !== null ? ` (z = ${z.toFixed(2)}${sig ? ', significant' : ', not significant yet'})` : ''}. ${weak.label} is where this KPI leaks.${androidNote}`,
          action: actionOf(k.id),
          kpiIds: [k.id],
          evidence: rows.map((r) => `${r.label}: ${r.value}% (${r.numerator} of ${r.n})`),
        },
      });
    }
  }
  out.push(...segInsights.sort((a, b) => b.diff - a.diff).slice(0, 3).map((s) => s.insight));

  // 6. Wins --------------------------------------------------------------------
  const wins = measured.filter((k) => k.status === 'on_track');
  if (wins.length) {
    out.push({
      id: 'wins',
      kind: 'win',
      severity: 'positive',
      title: `On track: ${wins.map((k) => k.name).join(', ')}`,
      body: wins.map((k) => `${k.name} ${valN(k)} vs ${k.threshold?.direction === 'lower' ? '≤ ' : ''}${fmtValue(k.threshold?.target ?? null, k.unit)}`).join(' · ') + '.',
      action: wins.some((k) => k.lowSample) ? 'Keep watching — some of these rest on small samples.' : null,
      kpiIds: wins.map((k) => k.id),
      evidence: wins.map((k) => `${k.name}: ${valN(k)}`),
    });
  }

  // 7. Sample size -------------------------------------------------------------
  const small = measured.filter((k) => k.lowSample || k.status === 'too_few');
  if (small.length) {
    const minN = Math.min(...small.map((k) => k.current.n).filter((n) => n > 0));
    out.push({
      id: 'sample',
      kind: 'sample',
      severity: 'info',
      title: `${small.length} KPIs rest on fewer than ${LOW_SAMPLE_N} users`,
      body: `${small.map((k) => `${k.name} (n=${k.current.n})`).join(', ')}. With n=${Number.isFinite(minN) ? minN : 0}, one user moves a rate by ${Number.isFinite(minN) && minN > 0 ? Math.round(100 / minN) : '—'} points. Read these as direction, not truth; a longer period (28d / 90d) gives larger samples.`,
      action: null,
      kpiIds: small.map((k) => k.id),
      evidence: small.map((k) => `${k.name}: n=${k.current.n}`),
    });
  }

  // 8. Coverage ------------------------------------------------------------------
  const unmeasured = kpis.filter((k) => k.status === 'not_measured');
  if (unmeasured.length) {
    out.push({
      id: 'coverage',
      kind: 'coverage',
      severity: 'info',
      title: `Not measured yet: ${unmeasured.map((k) => k.name).join(', ')}`,
      body: unmeasured.map((k) => `${k.name}: ${k.notMeasured?.reason}`).join(' '),
      action: unmeasured.map((k) => k.notMeasured?.needed).filter(Boolean).join(' '),
      kpiIds: unmeasured.map((k) => k.id),
      evidence: [],
    });
  }
  return out;
}

/** "Why it likely moved": a segment mix shift that explains most of a rate change, else the segment that moved most. */
export function explainMove(k: PmfKpi): string | null {
  if (k.change === null) return null;
  let best: { text: string; weight: number } | null = null;
  for (const seg of k.segments) {
    const d = decompose(seg);
    if (!d || !d.driver) continue;
    const total = Math.abs(d.mix) + Math.abs(d.rate);
    if (!total) continue;
    if (Math.abs(d.mix) >= Math.abs(d.rate) && Math.abs(d.mix) >= 2) {
      const text = `Mostly a ${seg.dimension} mix shift: ${d.driver.label} went from ${Math.round(d.driver.shareFrom)}% to ${Math.round(d.driver.shareTo)}% of the base${d.driver.rate !== null ? ` (its previous rate: ${d.driver.rate}%)` : ''}; within-segment rates moved ${pts(d.rate)} combined, the mix ${pts(d.mix)}.`;
      if (!best || Math.abs(d.mix) > best.weight) best = { text, weight: Math.abs(d.mix) };
    } else {
      // Largest within-segment move with a usable sample.
      const rows = seg.rows.filter((r) => r.value !== null && r.previous.value !== null && r.n >= 5 && r.previous.n >= 5);
      const top = rows.sort((a, b) => Math.abs((b.value as number) - (b.previous.value as number)) - Math.abs((a.value as number) - (a.previous.value as number)))[0];
      if (!top) continue;
      const delta = (top.value as number) - (top.previous.value as number);
      const text = `The change is within segments, led by ${top.label} (${fmtValue(top.previous.value, k.unit)} → ${fmtValue(top.value, k.unit)}, n ${top.previous.n} → ${top.n}); the ${seg.dimension} mix explains only ${pts(d.mix)}.`;
      if (!best || Math.abs(delta) * 0.5 > best.weight) best = { text, weight: Math.abs(delta) * 0.5 };
    }
  }
  return best?.text ?? null;
}
