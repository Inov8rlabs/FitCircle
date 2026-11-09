/**
 * Trial sync (docs/TRIAL_SYNC.md): one control for the Pro free-trial length across the App Store
 * introductory offers, the Google Play free-trial offers and remote config `trial_days` (server
 * copy + the Stripe web trial).
 *
 * - status(): live store offers (GETs only) + trial_days default / rules + whether they agree.
 * - plan(days): dry run. Exact store API calls and remote-config writes, validation, warnings and a
 *   planHash over the state the plan was computed from.
 * - apply(days, planHash, actor): recomputes the plan and runs it only when the hash still matches.
 *   Order: store writes → read-back verify → remote config. Any store failure stops the run before
 *   remote config, so app / web copy never promises a longer trial than a store gives. Every step is
 *   written to remote_config_changes (config_key 'trial_sync') with the admin actor; the remote
 *   config writes audit themselves under 'trial_days'. Re-running after a partial failure plans
 *   only what is still missing (each step is derived from the live state), so retries are safe.
 */
import { createHash, randomUUID } from 'node:crypto';

import { webTrialEnabled } from '../config/trial';
import { type RcPlatform } from '../remote-config/audience';
import { codeDefault } from '../remote-config/registry';
import { RemoteConfigError, RemoteConfigService } from '../remote-config/service';
import {
  AscOffersClient,
  ascOpRequest,
  ascTrialTerritories,
  describeAscOp,
  planAscOps,
  verifyAsc,
  type AscIntroOffer,
  type AscOffersSnapshot,
  type AscOp,
} from '../stores/asc-offers';
import { PlayOffersClient, describePlayOp, isTrialOffer, planPlayOps, verifyPlay, type PlayOffersSnapshot, type PlayOp } from '../stores/play-offers';
import { SUPPORTED_TRIAL_DAYS, ascDurationFor, isSupportedTrialDays, type SupportedTrialDays } from '../stores/trial-durations';
import { createAdminSupabase } from '../supabase-admin';

const KEY = 'trial_days' as const;
const AUDIT_KEY = 'trial_sync';
const PLATFORMS: RcPlatform[] = ['ios', 'android', 'web'];

// ---------------------------------------------------------------------------- wire shapes

export interface RcTrialRule {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  audience: Record<string, unknown>;
  value: unknown;
  updatedAt: string | null;
  /** platform = audience is only `platforms` (or empty); conditional = also other conditions. */
  kind: 'platform' | 'conditional';
}

export interface TrialSyncStatus {
  checkedAt: string;
  supportedDays: number[];
  appStore: {
    configured: boolean;
    error: string | null;
    /** The one trial length every subscription × trial territory has now, else null. */
    days: number | null;
    consistent: boolean;
    territories: string[];
    subscriptions: Array<{ subscriptionId: string; productId: string; name: string; state: string | null; offers: AscIntroOffer[] }>;
  };
  googlePlay: {
    configured: boolean;
    canWrite: boolean;
    error: string | null;
    days: number | null;
    consistent: boolean;
    basePlans: Array<{
      productId: string;
      basePlanId: string;
      state: string;
      offers: Array<{ offerId: string; state: string; trialDays: number | null; trialDuration: string | null; regions: string[]; tags: string[] }>;
    }>;
  };
  remoteConfig: {
    key: typeof KEY;
    codeDefault: number;
    default: { value: unknown; updatedBy: string | null; updatedAt: string | null } | null;
    rules: RcTrialRule[];
    /** What a request from each platform resolves to (conditional rules ignored). */
    effective: Record<RcPlatform, number>;
    webTrialEnabled: boolean;
  };
  inSync: boolean;
  issues: string[];
  warnings: string[];
}

export type StepStore = 'app_store' | 'google_play' | 'stores' | 'remote_config';

export interface PlanStep {
  id: string;
  store: StepStore;
  action: string;
  description: string;
  request?: { method: string; path: string; body?: unknown };
}

export interface TrialSyncPlan {
  days: number;
  planHash: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
  steps: PlanStep[];
  noop: boolean;
  status: TrialSyncStatus;
}

export interface StepResult extends PlanStep {
  status: 'done' | 'failed' | 'skipped';
  error?: string;
  detail?: unknown;
}

export interface TrialSyncApplyResult {
  runId: string;
  days: number;
  ok: boolean;
  steps: StepResult[];
  /** Descriptions of the steps that changed something. */
  changed: string[];
  remoteConfigChanged: boolean;
  message: string;
  status: TrialSyncStatus | null;
}

// ---------------------------------------------------------------------------- internal plan items

type Item =
  | { step: PlanStep; kind: 'asc'; op: AscOp }
  | { step: PlanStep; kind: 'play'; op: PlayOp }
  | { step: PlanStep; kind: 'rc_default'; value: number }
  | { step: PlanStep; kind: 'rc_delete_rule'; ruleId: string };

interface Live {
  status: TrialSyncStatus;
  asc: AscOffersSnapshot | null;
  play: PlayOffersSnapshot | null;
}

export interface TrialSyncDeps {
  asc: AscOffersClient | null;
  play: PlayOffersClient;
  now: () => Date;
  env: Record<string, string | undefined>;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

function ruleKind(audience: Record<string, unknown>): RcTrialRule['kind'] {
  return Object.keys(audience ?? {}).every((k) => k === 'platforms') ? 'platform' : 'conditional';
}

/** Per platform: the first enabled platform-only rule that matches, else the admin default, else the code default. */
export function effectiveTrialDays(rules: readonly RcTrialRule[], defaultValue: unknown, code: number): Record<RcPlatform, number> {
  const base = typeof defaultValue === 'number' && Number.isInteger(defaultValue) && defaultValue > 0 ? defaultValue : code;
  const out = {} as Record<RcPlatform, number>;
  for (const p of PLATFORMS) {
    const hit = rules.find((r) => {
      if (!r.enabled || r.kind !== 'platform' || typeof r.value !== 'number') return false;
      const platforms = (r.audience.platforms as string[] | undefined) ?? null;
      return !platforms || platforms.includes(p);
    });
    out[p] = hit ? (hit.value as number) : base;
  }
  return out;
}

function uniformAscDays(snap: AscOffersSnapshot, territories: string[]): { days: number | null; consistent: boolean } {
  const seen = new Set<string>();
  let complete = territories.length > 0;
  for (const s of snap.subscriptions) {
    for (const t of territories) {
      const cur = s.offers.filter((o) => o.territory === t && o.timing === 'current');
      if (cur.length !== 1 || cur[0].offerMode !== 'FREE_TRIAL') complete = false;
      for (const o of cur) seen.add(o.offerMode === 'FREE_TRIAL' ? o.duration : `${o.offerMode}:${o.duration}`);
    }
  }
  if (seen.size !== 1 || !complete) return { days: null, consistent: false };
  const only = [...seen][0];
  const days = SUPPORTED_TRIAL_DAYS.find((d) => ascDurationFor(d) === only) ?? null;
  return { days, consistent: days !== null };
}

function uniformPlayDays(snap: PlayOffersSnapshot): { days: number | null; consistent: boolean; any: boolean } {
  const seen = new Set<number | null>();
  let complete = true;
  let any = false;
  for (const bp of snap.basePlans) {
    if (!bp.autoRenewing || bp.state !== 'ACTIVE') continue;
    const trials = bp.offers.filter(isTrialOffer);
    if (!trials.length) continue;
    any = true;
    const active = trials.filter((o) => o.state === 'ACTIVE');
    if (active.length !== 1) complete = false;
    for (const o of active) seen.add(o.trialDays);
  }
  if (!any || seen.size !== 1 || !complete) return { days: null, consistent: false, any };
  const days = [...seen][0];
  return { days, consistent: days !== null, any };
}

export class TrialSyncService {
  constructor(private readonly deps: TrialSyncDeps) {}

  static fromEnv(): TrialSyncService {
    return new TrialSyncService({ asc: AscOffersClient.fromEnv(), play: PlayOffersClient.fromEnv(), now: () => new Date(), env: process.env });
  }

  // ---------------------------------------------------------------------------- status

  private async live(): Promise<Live> {
    const now = this.deps.now();
    const issues: string[] = [];
    const warnings: string[] = [];

    const [ascRes, playRes, keysRes] = await Promise.allSettled([
      this.deps.asc ? this.deps.asc.snapshot(now) : Promise.resolve(null),
      this.deps.play.canRead ? this.deps.play.snapshot() : Promise.resolve(null),
      RemoteConfigService.listKeys(),
    ]);

    // App Store
    const asc = ascRes.status === 'fulfilled' ? ascRes.value : null;
    const ascError = !this.deps.asc ? 'App Store Connect is not configured (ASC_KEY_ID / ASC_ISSUER_ID / ASC_PRIVATE_KEY)' : ascRes.status === 'rejected' ? errText(ascRes.reason) : null;
    const territories = asc ? ascTrialTerritories(asc) : [];
    const ascU = asc ? uniformAscDays(asc, territories) : { days: null, consistent: false };
    if (ascError) issues.push(`App Store: ${ascError}`);
    else if (!territories.length) issues.push('App Store: no subscription has a current free-trial introductory offer.');
    else if (!ascU.consistent) issues.push('App Store: the free trial is not the same length on every subscription and territory.');

    // Google Play
    const play = playRes.status === 'fulfilled' ? playRes.value : null;
    const playError = !this.deps.play.canRead
      ? 'Google Play is not configured (GOOGLE_PLAY_MONETIZATION_SA_KEY or GOOGLE_PLAY_SA_KEY)'
      : playRes.status === 'rejected'
        ? errText(playRes.reason)
        : null;
    const playU = play ? uniformPlayDays(play) : { days: null, consistent: false, any: false };
    if (playError) issues.push(`Google Play: ${playError}`);
    else if (!playU.any) issues.push('Google Play: no active base plan has a free-trial offer.');
    else if (!playU.consistent) issues.push('Google Play: base plans do not have exactly one active free-trial offer of the same length.');

    // Remote config
    if (keysRes.status === 'rejected') throw keysRes.reason;
    const key = keysRes.value.keys.find((k) => k.key === KEY);
    const code = codeDefault(KEY) as number;
    const rules: RcTrialRule[] = (key?.rules ?? []).map((r) => {
      const audience = (r.audience ?? {}) as Record<string, unknown>;
      return { id: r.id, name: r.name, enabled: r.enabled, priority: r.priority, audience, value: r.value, updatedAt: r.updatedAt ?? null, kind: ruleKind(audience) };
    });
    const def = key?.default ?? null;
    const effective = effectiveTrialDays(rules, def?.value, code);
    for (const r of rules.filter((x) => x.enabled && x.kind === 'conditional')) {
      warnings.push(`Remote config rule "${r.name}" sets trial_days = ${String(r.value)} for part of the audience (beyond platform); trial sync leaves it alone.`);
    }
    const webOn = webTrialEnabled(this.deps.env);
    if (!webOn) warnings.push('STRIPE_TRIAL_DAYS is unset: web checkout gives no trial, so trial_days only changes copy on web.');

    if (ascU.days !== null && effective.ios !== ascU.days) issues.push(`iOS copy says ${effective.ios} days but the App Store gives ${ascU.days}.`);
    if (playU.days !== null && effective.android !== playU.days) issues.push(`Android copy says ${effective.android} days but Google Play gives ${playU.days}.`);
    if (ascU.days !== null && playU.days !== null && ascU.days !== playU.days) issues.push(`The App Store (${ascU.days} days) and Google Play (${playU.days} days) differ.`);
    const storeDays = ascU.days ?? playU.days;
    if (storeDays !== null && effective.web !== storeDays) issues.push(`Web (Stripe) trial is ${effective.web} days but the stores give ${storeDays}.`);

    const inSync = !ascError && !playError && ascU.consistent && playU.consistent && ascU.days === playU.days && effective.ios === ascU.days && effective.android === playU.days && effective.web === ascU.days;

    const status: TrialSyncStatus = {
      checkedAt: now.toISOString(),
      supportedDays: [...SUPPORTED_TRIAL_DAYS],
      appStore: {
        configured: !!this.deps.asc,
        error: ascError,
        days: ascU.days,
        consistent: ascU.consistent,
        territories,
        subscriptions: (asc?.subscriptions ?? []).map((s) => ({ subscriptionId: s.subscriptionId, productId: s.productId, name: s.name, state: s.state, offers: s.offers.filter((o) => o.timing !== 'ended') })),
      },
      googlePlay: {
        configured: this.deps.play.canRead,
        canWrite: this.deps.play.canWrite,
        error: playError,
        days: playU.days,
        consistent: playU.consistent,
        basePlans: (play?.basePlans ?? [])
          .filter((bp) => bp.autoRenewing)
          .map((bp) => ({
            productId: bp.productId,
            basePlanId: bp.basePlanId,
            state: bp.state,
            offers: bp.offers.map((o) => ({ offerId: o.offerId, state: o.state, trialDays: o.trialDays, trialDuration: o.trialDuration, regions: o.regions, tags: o.tags })),
          })),
      },
      remoteConfig: { key: KEY, codeDefault: code, default: def ? { value: def.value, updatedBy: def.updatedBy ?? null, updatedAt: def.updatedAt ?? null } : null, rules, effective, webTrialEnabled: webOn },
      inSync,
      issues,
      warnings,
    };
    return { status, asc, play };
  }

  async status(): Promise<TrialSyncStatus> {
    return (await this.live()).status;
  }

  // ---------------------------------------------------------------------------- plan

  private hash(days: number, live: Live): string {
    const s = live.status;
    const state = {
      days,
      asc: s.appStore.error ?? s.appStore.subscriptions.map((x) => [x.subscriptionId, x.offers.map((o) => [o.id, o.territory, o.offerMode, o.duration, o.startDate, o.endDate, o.timing])]),
      play: s.googlePlay.error ?? s.googlePlay.basePlans.map((b) => [b.productId, b.basePlanId, b.state, b.offers.map((o) => [o.offerId, o.state, o.trialDuration, o.regions, o.tags])]),
      rc: { default: s.remoteConfig.default?.value ?? null, rules: s.remoteConfig.rules.map((r) => [r.id, r.enabled, r.priority, r.value, r.audience, r.updatedAt]) },
      creds: { asc: s.appStore.configured, playWrite: s.googlePlay.canWrite },
    };
    return createHash('sha256').update(stable(state)).digest('hex');
  }

  private build(days: number, live: Live): { plan: TrialSyncPlan; items: Item[] } {
    const s = live.status;
    const errors: string[] = [];
    const warnings: string[] = [...s.warnings];
    const items: Item[] = [];
    let n = 0;
    const id = () => `s${++n}`;

    if (!isSupportedTrialDays(days)) {
      errors.push(`${days} days is not supported. Both stores support: ${SUPPORTED_TRIAL_DAYS.join(', ')} days (Apple's offer durations are a fixed list; month-based ones are not a whole number of days).`);
    }
    if (s.appStore.error) errors.push(`Can't read the App Store: ${s.appStore.error}`);
    if (s.googlePlay.error) errors.push(`Can't read Google Play: ${s.googlePlay.error}`);

    if (isSupportedTrialDays(days)) {
      const d: SupportedTrialDays = days;
      if (live.asc) {
        if (!s.appStore.territories.length) errors.push('App Store: no current free-trial introductory offer to base the change on. Set one up in App Store Connect first.');
        const { ops, warnings: w } = planAscOps(live.asc, d);
        warnings.push(...w);
        for (const op of ops) items.push({ kind: 'asc', op, step: { id: id(), store: 'app_store', action: op.kind === 'asc.delete' ? 'delete_offer' : 'create_offer', description: describeAscOp(op), request: ascOpRequest(op) } });
        if (ops.length) {
          const creates = ops.filter((o) => o.kind === 'asc.create').length;
          warnings.push(
            `App Store introductory offers can't be edited: in each of ${creates} subscription × territory pairs the current offer is deleted and a new ${d}-day offer starting today is created right after it (a gap of about a second; if the create fails the old offer is re-created).`
          );
          warnings.push('App Store: introductory offers on an approved subscription have no review state and need no App Review. Apple notes changes can take up to an hour to show in sandbox.');
        }
      }
      if (live.play) {
        const { ops, warnings: w, errors: e } = planPlayOps(live.play, d);
        warnings.push(...w);
        errors.push(...e);
        for (const op of ops) items.push({ kind: 'play', op, step: { id: id(), store: 'google_play', action: op.kind.replace('play.', '') + '_offer', description: describePlayOp(op, d), request: this.deps.play.opRequest(op) } });
        if (ops.length && !this.deps.play.canWrite) errors.push('Google Play writes need GOOGLE_PLAY_MONETIZATION_SA_KEY (a service account with the Play Console app permission "Manage store presence"). Reads work with the release-tracker key.');
        if (ops.length) warnings.push('Google Play: deactivating an offer stops new purchases only; people already on it keep it. Offer changes need no review.');
      }
      if (items.length) {
        warnings.push('People who already used a free trial are NOT eligible again: Apple allows one introductory offer per subscription group, and the Play offers target "never had any subscription in this app". Trials already running keep their length.');
      }

      // Remote config: default = days; drop platform-only rules (redundant once the stores and default agree).
      const rc = s.remoteConfig;
      if (rc.default?.value !== d) {
        items.push({
          kind: 'rc_default',
          value: d,
          step: { id: id(), store: 'remote_config', action: 'set_default', description: `Remote config: trial_days default ${rc.default ? String(rc.default.value) : `unset (code default ${rc.codeDefault})`} → ${d}`, request: { method: 'PUT', path: `/api/admin/remote-config/${KEY}/default`, body: { value: d } } },
        });
      }
      for (const r of rc.rules.filter((x) => x.enabled && x.kind === 'platform')) {
        const platforms = (r.audience.platforms as string[] | undefined)?.join(', ') ?? 'everyone';
        items.push({
          kind: 'rc_delete_rule',
          ruleId: r.id,
          step: {
            id: id(),
            store: 'remote_config',
            action: 'delete_rule',
            description: `Remote config: delete rule "${r.name}" (${platforms} → ${String(r.value)} days); ${r.value === d ? 'redundant once the default is ' + d : 'it would contradict the stores'}`,
            request: { method: 'DELETE', path: `/api/admin/remote-config/rules/${r.id}` },
          },
        });
      }
    }

    const plan: TrialSyncPlan = {
      days,
      planHash: this.hash(days, live),
      valid: errors.length === 0,
      errors,
      warnings: [...new Set(warnings)],
      steps: items.map((i) => i.step),
      noop: items.length === 0,
      status: s,
    };
    return { plan, items };
  }

  async plan(days: number): Promise<TrialSyncPlan> {
    return this.build(days, await this.live()).plan;
  }

  // ---------------------------------------------------------------------------- apply

  private async audit(runId: string, actor: string | null, days: number, action: 'create' | 'update' | 'delete', before: unknown, after: unknown) {
    const { error } = await createAdminSupabase()
      .from('remote_config_changes')
      .insert({ config_key: AUDIT_KEY, target: 'default', rule_id: null, action, actor, before: { runId, days, ...(before as object) }, after, at: new Date().toISOString() });
    if (error) console.error('[trial-sync] audit insert failed:', error.message);
  }

  async apply(days: number, planHash: string, actor: { email: string | null }): Promise<TrialSyncApplyResult> {
    const live = await this.live();
    const { plan, items } = this.build(days, live);
    if (plan.planHash !== planHash) {
      throw new RemoteConfigError(409, 'PLAN_STALE', 'The stores or remote config changed since this plan was previewed. Preview again.', { plan });
    }
    if (!plan.valid) throw new RemoteConfigError(422, 'PLAN_INVALID', plan.errors[0] ?? 'The plan is not valid', { errors: plan.errors });

    const runId = randomUUID();
    const results: StepResult[] = items.map((i) => ({ ...i.step, status: 'skipped' as const }));
    const who = actor.email;
    let failed = false;

    const record = async (idx: number, ok: boolean, error: string | undefined, detail: unknown, auditAction: 'create' | 'update' | 'delete', before: unknown) => {
      results[idx] = { ...results[idx], status: ok ? 'done' : 'failed', ...(error ? { error } : {}), ...(detail !== undefined ? { detail } : {}) };
      await this.audit(runId, who, days, auditAction, { step: results[idx].id, store: results[idx].store, op: results[idx].action, description: results[idx].description, ...((before as object) ?? {}) }, { status: results[idx].status, error: error ?? null, detail: detail ?? null });
    };

    // 1. Store writes, in plan order. Stop at the first failure.
    for (let i = 0; i < items.length && !failed; i++) {
      const item = items[i];
      if (item.kind === 'asc') {
        const op = item.op;
        try {
          const res = await this.deps.asc!.apply(op);
          await record(i, true, undefined, res, op.kind === 'asc.delete' ? 'delete' : 'create', { previous: op.kind === 'asc.delete' ? op.previous : op.replaces });
        } catch (e) {
          let detail: Record<string, unknown> = {};
          let recovered = false;
          if (op.kind === 'asc.create') {
            // ASC can answer 5xx and still create: look before re-creating the old offer.
            try {
              const now = await this.deps.asc!.territoryOffers(op.subscriptionId, op.territory, this.deps.now());
              if (now.some((o) => o.timing === 'current' && o.offerMode === 'FREE_TRIAL' && o.duration === op.duration)) recovered = true;
              else if (op.replaces && !now.some((o) => o.timing === 'current')) {
                await this.deps.asc!.restore(op.replaces, op.subscriptionId);
                detail = { restored: `${op.replaces.offerMode} ${op.replaces.duration}` };
              }
            } catch (re) {
              detail = { restoreError: errText(re) };
            }
          }
          if (recovered) await record(i, true, undefined, { note: 'create answered an error but the offer exists' }, 'create', { previous: op.kind === 'asc.create' ? op.replaces : null });
          else {
            await record(i, false, errText(e), detail, op.kind === 'asc.delete' ? 'delete' : 'create', {});
            failed = true;
          }
        }
      } else if (item.kind === 'play') {
        try {
          const res = await this.deps.play.apply(item.op);
          await record(i, true, undefined, res ? { state: res.state ?? null, offerId: res.offerId ?? item.op.offerId } : undefined, item.op.kind === 'play.create' ? 'create' : item.op.kind === 'play.deactivate' ? 'delete' : 'update', {});
        } catch (e) {
          await record(i, false, errText(e), undefined, 'update', {});
          failed = true;
        }
      }
    }

    // 2. Read back the stores (always, also when no store step was needed).
    const verifyStep: StepResult = { id: 'verify', store: 'stores', action: 'verify', description: `Read back both stores: every trial is ${days} days`, status: 'skipped' };
    let after: Live | null = null;
    if (!failed && isSupportedTrialDays(days)) {
      try {
        after = await this.live();
        const problems = [
          ...(after.asc ? verifyAsc(after.asc, days, live.status.appStore.territories) : ['App Store: read-back failed']),
          ...(after.play
            ? verifyPlay(
                after.play,
                days,
                (live.play?.basePlans ?? []).filter((bp) => bp.autoRenewing && bp.state === 'ACTIVE' && bp.offers.some(isTrialOffer))
              )
            : ['Google Play: read-back failed']),
        ];
        Object.assign(verifyStep, problems.length ? { status: 'failed', error: problems.join(' | ') } : { status: 'done' });
        if (problems.length) failed = true;
      } catch (e) {
        Object.assign(verifyStep, { status: 'failed', error: errText(e) });
        failed = true;
      }
      await this.audit(runId, who, days, 'update', { step: 'verify' }, { status: verifyStep.status, error: verifyStep.error ?? null });
    }

    // 3. Remote config, only when every store step and the read-back succeeded.
    let rcChanged = false;
    if (!failed) {
      for (let i = 0; i < items.length && !failed; i++) {
        const item = items[i];
        try {
          if (item.kind === 'rc_default') {
            await RemoteConfigService.setDefault(KEY, { value: item.value }, { email: who });
          } else if (item.kind === 'rc_delete_rule') {
            await RemoteConfigService.deleteRule(item.ruleId, { email: who });
          } else continue;
          rcChanged = true;
          results[i] = { ...results[i], status: 'done' };
        } catch (e) {
          results[i] = { ...results[i], status: 'failed', error: errText(e) };
          failed = true;
        }
      }
    }

    const steps = [...results.filter((r) => r.store !== 'remote_config'), verifyStep, ...results.filter((r) => r.store === 'remote_config')];
    const changed = steps.filter((r) => r.status === 'done' && r.action !== 'verify').map((r) => r.description);
    const storeChanged = results.some((r) => r.store !== 'remote_config' && r.status === 'done');
    const message = !failed
      ? plan.noop
        ? `Already in sync at ${days} days; nothing changed.`
        : `Free trial is now ${days} days on the App Store, Google Play and remote config.`
      : rcChanged
        ? 'Stores are updated but a remote config write failed; remote config may be partly updated. Re-check and preview again.'
        : storeChanged
          ? 'A store step failed. The steps marked done DID change the store; remote config was NOT changed. Re-check, then preview again to finish.'
          : 'Nothing was changed: the first step failed.';
    await this.audit(runId, who, days, 'update', { step: 'summary', planHash }, { ok: !failed, message, changed });

    let finalStatus: TrialSyncStatus | null = null;
    try {
      finalStatus = rcChanged || !after ? await this.status() : after.status;
    } catch {
      finalStatus = null;
    }
    return { runId, days, ok: !failed, steps, changed, remoteConfigChanged: rcChanged, message, status: finalStatus };
  }
}
