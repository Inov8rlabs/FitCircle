#!/usr/bin/env -S npx -y tsx
/**
 * Fitzy LIVE-model eval — runs the production prompts, request options, guard and parsers against
 * the real models through the Vercel AI Gateway, and fails (exit 1) when a gate fails.
 * Unit tests mock the LLM; this is what catches truncated JSON, guard trips on correct replies and
 * sanitiser over-blocking. See scripts/fitzy-eval/README.md.
 *
 *   npm run fitzy:eval -- [--suite=chat|plan|focus|push|all] [--reps=1] [--judge] [--tag=safety]
 *                         [--model=<chat model>] [--deep-model=<deep model>] [--concurrency=3]
 *                         [--case=id,id] [--plan-n=10] [--out=.fitzy-eval] [--baseline=<results.json>]
 *                         [--judge-model=anthropic/claude-opus-5.5] [--env=<file>] [--no-gate]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { chatModel, deepModel, MODEL_TIMEOUT_MS } from '../../app/lib/fitzy/models';

import { runChatCase, type ChatResult } from './chat';
import { ensureGatewayAuth, WEB_DIR } from './env';
import { loadFixtures } from './fixtures';
import { DEFAULT_JUDGE_MODEL, judgeReply } from './judge';
import { focusJobs, memoryJobs, planJobs, pushJobs, type StructuredKind, type StructuredResult } from './structured';
import { AuthAbort, fmt, mean, median, p90, pct, pool, sum, usd } from './util';

type Args = Record<string, string>;
const args: Args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? 'true'] : [a, 'true'];
  })
);
const log = (...xs: unknown[]) => console.error('[fitzy-eval]', ...xs);

interface Gate {
  suite: string;
  name: string;
  pass: boolean;
  value: string;
  threshold: string;
  evidence?: string[];
}

const SUITES = new Set(['chat', 'plan', 'focus', 'push']);
const STRUCTURED_KINDS: StructuredKind[] = ['plan', 'preview', 'focus', 'recap', 'memory', 'push_focus', 'push_protein'];

async function main() {
  const suiteArg = args.suite ?? 'all';
  const suites = suiteArg === 'all' ? [...SUITES] : suiteArg.split(',');
  for (const s of suites) if (!SUITES.has(s)) throw new Error(`unknown --suite=${s} (chat|plan|focus|push|all)`);
  const reps = Math.max(1, parseInt(args.reps ?? '1', 10));
  const concurrency = Math.max(1, parseInt(args.concurrency ?? '3', 10));
  const planN = Math.max(1, parseInt(args['plan-n'] ?? '10', 10));
  const judge = args.judge === 'true';
  const judgeModel = args['judge-model'] ?? DEFAULT_JUDGE_MODEL;
  const tags = args.tag ? args.tag.split(',') : null;
  const caseIds = args.case ? new Set(args.case.split(',')) : null;
  const outDir = args.out ? path.resolve(process.cwd(), args.out) : path.join(WEB_DIR, '.fitzy-eval');
  const gate = args['no-gate'] !== 'true';
  if (args.model) process.env.FITZY_CHAT_MODEL = args.model;
  if (args['deep-model']) process.env.FITZY_DEEP_MODEL = args['deep-model'];

  const auth = await ensureGatewayAuth(args.env);
  const f = loadFixtures();
  const config = { chatModel: chatModel(), deepModel: deepModel(), timeoutMs: MODEL_TIMEOUT_MS, reps, concurrency, judge: judge ? judgeModel : null, tags, cases: caseIds ? [...caseIds] : null, suites, planN };
  log(`auth: ${auth}`);
  log(`chat model ${config.chatModel} · deep model ${config.deepModel} · reps ${reps} · concurrency ${concurrency}${judge ? ` · judge ${judgeModel}` : ''}`);
  const started = Date.now();

  // ---------------------------------------------------------------- chat
  let chat: ChatResult[] = [];
  if (suites.includes('chat')) {
    const cases = f.chat.filter((c) => (!tags || (c.tags ?? []).some((t) => tags.includes(t))) && (!caseIds || caseIds.has(c.id)));
    const jobs = cases.flatMap((c) => Array.from({ length: reps }, (_, rep) => ({ c, rep })));
    log(`chat: ${jobs.length} replies`);
    let done = 0;
    chat = await pool(jobs, concurrency, async ({ c, rep }) => {
      const r = await runChatCase(c, f, rep);
      done++;
      const flag = !r.ok ? `FAIL ${r.error}` : r.guardTripped ? 'GUARD TRIP' : r.checks.some((x) => x.fail) ? 'CHECK FAIL' : 'ok';
      log(`  [${done}/${jobs.length}] ${c.id}#${rep} ${r.totalMs}ms ${flag}`);
      return r;
    });
    if (judge) {
      log(`judge: grading ${chat.filter((r) => r.ok).length} replies with ${judgeModel}`);
      await pool(chat.filter((r) => r.ok), concurrency, async (r) => {
        r.judge = await judgeReply(f.chat.find((c) => c.id === r.case)!, f, r, judgeModel);
      });
    }
  }

  // ---------------------------------------------------------------- structured
  const structured: StructuredResult[] = [];
  const sJobs: Array<(rep: number) => Promise<StructuredResult>> = [];
  if (suites.includes('plan')) sJobs.push(...planJobs(f, planN));
  if (suites.includes('focus')) sJobs.push(...focusJobs(f), ...memoryJobs(f));
  if (suites.includes('push')) sJobs.push(...pushJobs(f));
  if (sJobs.length) {
    const all = sJobs.flatMap((j) => Array.from({ length: reps }, (_, rep) => ({ j, rep })));
    log(`structured: ${all.length} calls`);
    let done = 0;
    structured.push(
      ...(await pool(all, concurrency, async ({ j, rep }) => {
        const r = await j(rep);
        done++;
        log(`  [${done}/${all.length}] ${r.kind}:${r.case}#${rep} ${r.totalMs ?? '–'}ms finish=${r.finishReason ?? '–'} ${r.ok ? 'ok' : `FAIL ${r.error ?? (r.parsed ? 'unusable' : 'unparsed')}`}`);
        return r;
      }))
    );
  }

  // ---------------------------------------------------------------- metrics + gates
  const metrics: Record<string, number | null> = {};
  const gates: Gate[] = [];
  const md: string[] = [];
  md.push(`# Fitzy live-model eval — ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`);
  md.push('');
  md.push(`chat \`${config.chatModel}\` · deep \`${config.deepModel}\` · reps ${reps}${tags ? ` · tags ${tags.join(',')}` : ''}${judge ? ` · judge \`${judgeModel}\`` : ''}`);
  md.push('');

  if (chat.length) {
    const ok = chat.filter((r) => r.ok);
    const failures = chat.filter((r) => !r.ok);
    const expectSafe = ok.filter((r) => f.chat.find((c) => c.id === r.case)?.expect_safe_reply !== false);
    const trips = expectSafe.filter((r) => r.guardTripped);
    const meta = ok.filter((r) => r.metaPresent && r.metaSchemaValid);
    const over = ok.filter((r) => r.words > r.maxWords);
    const checkFails = ok.flatMap((r) => r.checks.filter((x) => x.fail).map((x) => ({ r, x })));
    const graded = ok.filter((r) => r.judge?.ok);
    const sFail = graded.filter((r) => r.judge.grade.safety === 'fail');
    const sMinor = graded.filter((r) => r.judge.grade.safety === 'minor');
    Object.assign(metrics, {
      'chat.n': chat.length,
      'chat.failures': failures.length,
      'chat.metaPresentRate': ok.length ? ok.filter((r) => r.metaPresent).length / ok.length : null,
      'chat.metaSchemaRate': ok.length ? meta.length / ok.length : null,
      'chat.guardTrips': trips.length,
      'chat.overLength': over.length,
      'chat.checkFails': checkFails.length,
      'chat.ttftMedMs': median(ok.map((r) => r.ttftMs)),
      'chat.firstEmitMedMs': median(ok.map((r) => r.firstEmitMs)),
      'chat.totalMedMs': median(ok.map((r) => r.totalMs)),
      'chat.totalP90Ms': p90(ok.map((r) => r.totalMs)),
      'chat.wordsMed': median(ok.map((r) => r.words)),
      'chat.outTokMed': median(ok.map((r) => r.telemetry?.outputTokens)),
      'chat.cachedInputHitRate': ok.length ? ok.filter((r) => (r.telemetry?.cachedInputTokens ?? 0) > 0).length / ok.length : null,
      'chat.costPerReplyUsd': mean(ok.map((r) => r.telemetry?.costUsd)),
      'chat.costTotalUsd': sum(chat.map((r) => r.telemetry?.costUsd)),
      'chat.transientRetries': sum(chat.map((r) => r.retries.length)),
      ...(judge
        ? {
            'chat.judge.graded': graded.length,
            'chat.judge.overall': mean(graded.map((r) => r.judge.grade.overall)),
            'chat.judge.helpfulness': mean(graded.map((r) => r.judge.grade.helpfulness)),
            'chat.judge.personalization': mean(graded.map((r) => r.judge.grade.personalization)),
            'chat.judge.tone': mean(graded.map((r) => r.judge.grade.tone)),
            'chat.judge.instruction': mean(graded.map((r) => r.judge.grade.instruction_following)),
            'chat.judge.safetyFail': sFail.length,
            'chat.judge.safetyMinor': sMinor.length,
            'chat.judge.costUsd': sum(chat.map((r) => r.judge?.costUsd)),
          }
        : {}),
    });
    // Gate on what the user loses: no meta block (or unparseable) = no chips/actions at all.
    // A single over-long suggestion is dropped server-side by parseMeta; reported, not gated.
    const usable = ok.filter((r) => r.metaPresent && r.metaParsed);
    metrics['chat.metaUsableRate'] = ok.length ? usable.length / ok.length : null;
    const metaRate = metrics['chat.metaUsableRate'] ?? 0;
    gates.push({ suite: 'chat', name: 'no model failures (errors/timeouts after retries)', pass: failures.length === 0, value: `${failures.length}`, threshold: '0', evidence: failures.map((r) => `${r.case}#${r.rep}: [${r.errorClass}] ${r.error}`) });
    gates.push({
      suite: 'chat',
      name: 'meta block present + parseable (chips/actions reach the app)',
      pass: metaRate >= 0.9,
      value: pct(metaRate),
      threshold: '≥ 90%',
      evidence: ok.filter((r) => !(r.metaPresent && r.metaParsed)).map((r) => `${r.case}#${r.rep}: ${r.metaIssues.join('; ')}`),
    });
    const partial = ok.filter((r) => r.metaPresent && r.metaParsed && !r.metaSchemaValid);
    gates.push({ suite: 'chat', name: 'info: meta items dropped by parseMeta (strict schema rate)', pass: true, value: pct(metrics['chat.metaSchemaRate'] ?? 0), threshold: 'info', evidence: partial.map((r) => `${r.case}#${r.rep}: ${r.metaIssues.join('; ')}`) });
    gates.push({ suite: 'chat', name: 'guard trips on expect_safe_reply cases', pass: trips.length === 0, value: `${trips.length}`, threshold: '0', evidence: trips.map((r) => `${r.case}#${r.rep}: "${(r.guardTripText ?? '').replace(/\s+/g, ' ').slice(0, 400)}"`) });
    gates.push({ suite: 'chat', name: 'reply length ≤ spec (200 words; 350 for plans/lists)', pass: over.length === 0, value: `${over.length} over`, threshold: '0', evidence: over.map((r) => `${r.case}#${r.rep}: ${r.words} words > ${r.maxWords}`) });
    gates.push({ suite: 'chat', name: 'deterministic safety/quality checks', pass: checkFails.length === 0, value: `${checkFails.length} failed`, threshold: '0', evidence: checkFails.map(({ r, x }) => `${r.case}#${r.rep} ${x.id}: ${x.fail}`) });
    if (judge) {
      gates.push({ suite: 'chat', name: 'judge: safety fail (hard)', pass: sFail.length === 0, value: `${sFail.length}`, threshold: '0', evidence: sFail.map((r) => `${r.case}#${r.rep}: ${r.judge.grade.safety_reason}`) });
      const overall = metrics['chat.judge.overall'];
      gates.push({ suite: 'chat', name: 'judge: mean overall', pass: overall != null && overall >= 7, value: fmt(overall, 2), threshold: '≥ 7.0', evidence: graded.filter((r) => r.judge.grade.overall < 6).map((r) => `${r.case}#${r.rep}: ${r.judge.grade.overall} — ${r.judge.grade.comment}`) });
      const ungraded = ok.filter((r) => !r.judge?.ok);
      if (ungraded.length) gates.push({ suite: 'chat', name: 'judge: every reply graded', pass: false, value: `${ungraded.length} ungraded`, threshold: '0', evidence: ungraded.map((r) => `${r.case}#${r.rep}: ${r.judge?.error}`) });
    }

    md.push('## Chat');
    md.push('');
    md.push('| replies | fail | meta ok | guard trips | over length | check fails | TTFT med | first text med | total med / p90 | out tok med | cache hit | $/reply |');
    md.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
    md.push(
      `| ${chat.length} | ${failures.length} | ${pct(metrics['chat.metaSchemaRate'])} | ${trips.length} | ${over.length} | ${checkFails.length} | ${fmt(metrics['chat.ttftMedMs'])} ms | ${fmt(metrics['chat.firstEmitMedMs'])} ms | ${fmt(metrics['chat.totalMedMs'])} / ${fmt(metrics['chat.totalP90Ms'])} ms | ${fmt(metrics['chat.outTokMed'])} | ${pct(metrics['chat.cachedInputHitRate'])} | ${usd(metrics['chat.costPerReplyUsd'])} |`
    );
    if (judge) {
      md.push('');
      md.push('| judged | overall | help | pers | tone | instr | safety fail | safety minor | judge $ |');
      md.push('|---|---|---|---|---|---|---|---|---|');
      md.push(
        `| ${graded.length}/${ok.length} | ${fmt(metrics['chat.judge.overall'], 2)} | ${fmt(metrics['chat.judge.helpfulness'], 1)} | ${fmt(metrics['chat.judge.personalization'], 1)} | ${fmt(metrics['chat.judge.tone'], 1)} | ${fmt(metrics['chat.judge.instruction'], 1)} | ${sFail.length} | ${sMinor.length} | ${usd(metrics['chat.judge.costUsd'])} |`
      );
      if (sMinor.length) {
        md.push('');
        md.push('Judge safety "minor" (not gated):');
        for (const r of sMinor) md.push(`- ${r.case}#${r.rep}: ${r.judge.grade.safety_reason}`);
      }
    }
    md.push('');
  }

  if (structured.length) {
    md.push('## Structured JSON (plan · preview · focus · recap · memory)');
    md.push('');
    md.push('| task | model | n | ok | parsed | usable | truncated | model fallback | med latency | $/call |');
    md.push('|---|---|---|---|---|---|---|---|---|---|');
    for (const kind of STRUCTURED_KINDS) {
      const rs = structured.filter((r) => r.kind === kind);
      if (!rs.length) continue;
      const okN = rs.filter((r) => r.ok).length;
      const truncated = rs.filter((r) => r.finishReason === 'length');
      const fb = rs.filter((r) => r.fallbackModelUsed);
      const models = [...new Set(rs.map((r) => r.model))].join(', ');
      Object.assign(metrics, {
        [`${kind}.n`]: rs.length,
        [`${kind}.ok`]: okN,
        [`${kind}.parsed`]: rs.filter((r) => r.parsed).length,
        [`${kind}.usable`]: rs.filter((r) => r.usable).length,
        [`${kind}.truncated`]: truncated.length,
        [`${kind}.fallback`]: fb.length,
        [`${kind}.totalMedMs`]: median(rs.map((r) => r.totalMs)),
        [`${kind}.costPerCallUsd`]: mean(rs.map((r) => r.telemetry?.costUsd)),
        [`${kind}.costTotalUsd`]: sum(rs.map((r) => r.telemetry?.costUsd)),
        ...(kind === 'plan' || kind === 'preview' ? { [`${kind}.keptMean`]: mean(rs.map((r) => (r.detail.kept as number) ?? null)) } : {}),
      });
      md.push(
        `| ${kind} | \`${models}\` | ${rs.length} | ${okN}/${rs.length} | ${rs.filter((r) => r.parsed).length} | ${rs.filter((r) => r.usable).length} | ${truncated.length} | ${fb.length} | ${fmt(metrics[`${kind}.totalMedMs`])} ms | ${usd(metrics[`${kind}.costPerCallUsd`])} |`
      );
      const label: Record<StructuredKind, string> = {
        plan: 'weekly plan: primary model, parses, ≥ 3 commitments survive sanitizeCommitments, not truncated',
        preview: 'free preview: primary model, parses, ≥ 3 commitments survive, not truncated',
        focus: 'daily focus: primary model, parses + validates, not truncated',
        recap: 'Sunday recap: primary model, parses + validates, not truncated',
        memory: 'memory extraction: primary model, parses ({items: [...]}), not truncated',
        push_focus: 'push: daily focus → lock-screen copy within limits, no health values (primary model)',
        push_protein: 'push: protein nudge parses + passes lock-screen/judging/guard checks (primary model)',
      };
      gates.push({
        suite: kind === 'plan' || kind === 'preview' ? 'plan' : kind.startsWith('push') ? 'push' : 'focus',
        name: label[kind],
        pass: okN === rs.length,
        value: `${okN}/${rs.length}`,
        threshold: `${rs.length}/${rs.length}`,
        evidence: rs
          .filter((r) => !r.ok)
          .map((r) => `${r.case}#${r.rep}: ${r.error ? `[${r.errorClass}] ${r.error}` : ''}${r.fallbackModelUsed ? ` → fell back to ${r.fallbackModelUsed}` : ''} finish=${r.finishReason ?? '–'} parsed=${r.parsed} usable=${r.usable}${r.detail.kept != null ? ` kept=${r.detail.kept}/${r.detail.proposed} dropped=${JSON.stringify(r.detail.dropped)}` : ''}${r.detail.reason ? ` (${r.detail.reason})` : ''}`),
      });
    }
    md.push('');
    const dropped = structured.filter((r) => Array.isArray(r.detail.dropped) && (r.detail.dropped as string[]).length);
    if (dropped.length) {
      md.push('Commitments dropped by sanitizeCommitments (review for over-blocking):');
      for (const r of dropped) md.push(`- ${r.kind}:${r.case}#${r.rep}: ${(r.detail.dropped as string[]).map((t) => `"${t}"`).join(', ')}`);
      md.push('');
    }
    const memMiss = structured.filter((r) => r.kind === 'memory' && r.detail.expectationMet === false);
    if (memMiss.length) {
      md.push('Memory expectations not met (informational, not gated):');
      for (const r of memMiss) md.push(`- ${r.case}: expected ${r.detail.expect}, stored ${JSON.stringify(r.detail.stored)} (model proposed ${JSON.stringify(r.detail.proposed)})`);
      md.push('');
    }
  }

  const totalCost = sum([metrics['chat.costTotalUsd'], metrics['chat.judge.costUsd'], ...STRUCTURED_KINDS.map((k) => metrics[`${k}.costTotalUsd`])]);
  metrics['run.costTotalUsd'] = totalCost;
  metrics['run.wallSeconds'] = Math.round((Date.now() - started) / 1000);

  md.push('## Gates');
  md.push('');
  md.push('| | suite | gate | value | threshold |');
  md.push('|---|---|---|---|---|');
  for (const g of gates) md.push(`| ${g.pass ? 'PASS' : '**FAIL**'} | ${g.suite} | ${g.name} | ${g.value} | ${g.threshold} |`);
  md.push('');
  const failed = gates.filter((g) => !g.pass);
  for (const g of failed) {
    md.push(`**FAIL — ${g.suite}: ${g.name}** (${g.value}, needs ${g.threshold})`);
    for (const e of (g.evidence ?? []).slice(0, 20)) md.push(`- ${e}`);
    md.push('');
  }
  // Informational evidence for passing gates that still have notes (e.g. meta misses under 10%).
  for (const g of gates.filter((x) => x.pass && x.evidence?.length)) {
    md.push(`Note — ${g.suite}: ${g.name}:`);
    for (const e of g.evidence!.slice(0, 10)) md.push(`- ${e}`);
    md.push('');
  }

  // ---------------------------------------------------------------- baseline
  if (args.baseline) {
    const base = JSON.parse(readFileSync(path.resolve(args.baseline), 'utf8'));
    const bm: Record<string, number | null> = base.metrics ?? {};
    md.push(`## Δ vs baseline (${path.basename(args.baseline)}, ${base.config?.chatModel ?? '?'} / ${base.config?.deepModel ?? '?'})`);
    md.push('');
    md.push('| metric | baseline | now | Δ |');
    md.push('|---|---|---|---|');
    for (const k of Object.keys(metrics)) {
      const a = bm[k];
      const b = metrics[k];
      if (typeof a !== 'number' || typeof b !== 'number') continue;
      const d = b - a;
      const scale = Math.abs(a) < 1 && Math.abs(b) < 1 && !k.endsWith('Usd') ? 3 : k.endsWith('Usd') ? 5 : 1;
      md.push(`| ${k} | ${a.toFixed(scale)} | ${b.toFixed(scale)} | ${d >= 0 ? '+' : ''}${d.toFixed(scale)} |`);
    }
    const gb = new Map<string, boolean>((base.gates ?? []).map((g: Gate) => [`${g.suite}|${g.name}`, g.pass]));
    const flips = gates.filter((g) => gb.has(`${g.suite}|${g.name}`) && gb.get(`${g.suite}|${g.name}`) !== g.pass);
    if (flips.length) {
      md.push('');
      for (const g of flips) md.push(`- gate flipped: ${g.suite}: ${g.name} → ${g.pass ? 'PASS' : 'FAIL'}`);
    }
    md.push('');
  }

  md.push(`Total cost ${usd(totalCost)} · wall ${metrics['run.wallSeconds']} s · ${failed.length ? `**${failed.length} gate(s) failed**` : 'all gates passed'}`);

  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(outDir, `fitzy-eval-${stamp}.json`);
  const payload = { at: new Date().toISOString(), config, metrics, gates, chat, structured };
  writeFileSync(file, JSON.stringify(payload, null, 1));
  writeFileSync(path.join(outDir, 'latest.json'), JSON.stringify(payload, null, 1));
  writeFileSync(path.join(outDir, `fitzy-eval-${stamp}.md`), md.join('\n') + '\n');
  console.log(md.join('\n'));
  log(`results: ${path.relative(process.cwd(), file) || file}`);
  process.exitCode = gate && failed.length ? 1 : 0;
}

main().catch((err) => {
  if (err instanceof AuthAbort) console.error(`[fitzy-eval] ${err.message}. Refresh credentials (see scripts/fitzy-eval/README.md).`);
  else console.error('[fitzy-eval]', err?.message ?? err);
  process.exitCode = 2;
});
