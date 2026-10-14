import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

import { embedTexts } from '../embeddings';
import type { PhotoParseResult } from '../types/nutrition';
import type { EvalCase, EvalReport, EvalRunStats, GoldenRecord } from '../types/nutrition-eval';

import { buildReport } from './nutrition-eval';
import type { GroundingMode } from './nutrition-grounding-service';
import { NutritionIntelligenceService, type ParsePhotoOptions } from './nutrition-intelligence-service';

/**
 * NutritionEvalRunner — drives golden images through the LIVE parse pipeline and scores them
 * (PRD §8.3). The scorers (nutrition-eval.ts) are pure; this is the side-effectful half:
 *   golden image -> fetch bytes -> parsePhoto (AI Gateway) -> EvalCase -> buildReport.
 *
 * Bake-off mode: `model` overrides the production vision model (no fallback, no content cache,
 * no per-user quota) so every golden image is a fresh call to exactly the model under test, and
 * the per-call latency/tokens are captured and costed from PRICE_TABLE.
 *
 * Stage 4 uses the REAL grounding path: the draft items coming back from parsePhoto already carry
 * `matchedFoodId` and DB-grounded macros, so dbMatches / groundedKcalPer100g reflect production
 * behaviour rather than a separate lexical lookup.
 *
 * Needs AI_GATEWAY_API_KEY (live LLM) + a foods table populated for Stage-4 DB matching.
 * Run via scripts/run-nutrition-eval.mjs.
 */

// A system user id used only for parse cost-accounting + search scoping during the eval.
const EVAL_USER_ID = '00000000-0000-0000-0000-0000000000e7';

// USD per 1M tokens (input, output) on the Vercel AI Gateway, 2026-10-13. Unknown models cost null.
export const PRICE_TABLE: Record<string, [number, number]> = {
  'anthropic/claude-haiku-4.5': [1.0, 5.0],
  'anthropic/claude-haiku-5.5': [0.1, 0.5],
  'anthropic/claude-sonnet-4.6': [3.0, 15.0],
  'anthropic/claude-sonnet-5.5': [2.0, 10.0],
  'google/gemini-3-flash': [0.5, 3.0],
  'google/gemini-3.1-flash-lite': [0.25, 1.5],
  'google/gemini-3.5-flash-lite': [0.3, 2.5],
  'google/gemini-3.5-flash': [1.5, 9.0],
  'google/gemini-3.8-flash': [0.75, 3.75],
  'google/gemma-4-31b-it': [0.14, 0.4],
  'openai/gpt-5-mini': [0.25, 2.0],
  'openai/gpt-5.4-mini': [0.75, 4.5],
  'openai/gpt-5.4-nano': [0.2, 1.25],
  'alibaba/qwen3-vl-instruct': [0.2, 0.88],
  'alibaba/qwen3.5-flash': [0.1, 0.4],
  'alibaba/qwen3.7-flash': [0.03, 0.13],
  'alibaba/qwen3.8-flash': [0.15, 0.47],
  'alibaba/qwen3.8-27b': [0.5, 3.0],
  'alibaba/qwen3.8-max': [2.0, 6.0],
  'moonshotai/kimi-k2.5': [0.6, 3.0],
  'moonshotai/kimi-k2.6': [0.95, 4.0],
  'moonshotai/kimi-k3': [3.0, 15.0],
  'zai/glm-4.5v': [0.6, 1.8],
  'zai/glm-5.3-flash': [0.15, 0.5],
  'zai/glm-5.3-flashx': [0.37, 1.25],
  'zai/glm-5v-turbo': [1.2, 4.0],
  'deepseek/deepseek-v4.1-flash': [0.3, 1.2],
  'stepfun/step-3.7-flash': [0.2, 1.15],
  'mistral/mistral-small': [0.15, 0.6],
};

export interface RunOptions {
  concurrency?: number;
  /** Bake-off: the vision model to test (overrides production primary; disables fallback/cache/quota). */
  model?: string;
  promptVariant?: string;
  /** Grounding strategy to evaluate ('generic' | 'legacy' | 'off'); default = service default. */
  grounding?: GroundingMode;
  /** Only run the first N golden records (after loading). */
  limit?: number;
  /** Directory to persist the JSON report + per-case outputs into (created if missing). */
  outDir?: string;
  /** Progress callback. */
  onProgress?: (done: number, total: number) => void;
}

export class NutritionEvalRunner {
  /** Load a golden dataset JSON file (array of GoldenRecord). */
  static loadGoldenSet(filePath: string): GoldenRecord[] {
    const raw = JSON.parse(readFileSync(filePath, 'utf8'));
    if (!Array.isArray(raw)) throw new Error('golden set must be a JSON array of GoldenRecord');
    return raw as GoldenRecord[];
  }

  /**
   * Fetch the image bytes for a golden record (http(s) URL or local file path), then apply
   * the same downscaling the shipped clients do (≤1568 px long edge, JPEG q0.8 — iOS
   * ImageProcessor / Android MealImageCompressor / web image-compression.ts) so the model sees
   * production-sized input. Phone-camera golden sets (SNAPMe) are 3–4k px originals; sending
   * those would both overstate token cost and give the model detail users never send.
   */
  private static async fetchImage(imageUri: string): Promise<{ bytes: Buffer; mime: string } | null> {
    try {
      let bytes: Buffer;
      let mime: string;
      if (/^https?:\/\//.test(imageUri)) {
        // GCS throttles bursts from parallel bake-off jobs; retry transient failures.
        let res: Response | null = null;
        for (let attempt = 0; attempt < 4; attempt++) {
          try {
            res = await fetch(imageUri);
            if (res.ok) break;
            if (res.status === 404) return null;
          } catch {
            res = null;
          }
          await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
        }
        if (!res?.ok) return null;
        mime = res.headers.get('content-type') ?? 'image/jpeg';
        bytes = Buffer.from(await res.arrayBuffer());
      } else {
        bytes = readFileSync(imageUri);
        mime = imageUri.endsWith('.png') ? 'image/png' : 'image/jpeg';
      }
      return await this.downscaleLikeClients(bytes, mime);
    } catch {
      return null;
    }
  }

  /**
   * pred × truth cosine-similarity matrix from text-embedding-3-small (one embedMany call per
   * case, ~20 short strings, fractions of a cent). Returns undefined when embeddings are
   * unavailable so the scorer silently falls back to token Dice alone.
   */
  private static async semanticSimilarities(
    predNames: string[],
    truthNames: string[],
  ): Promise<number[][] | undefined> {
    if (predNames.length === 0 || truthNames.length === 0) return undefined;
    try {
      const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
      const vectors = await embedTexts([...predNames, ...truthNames].map(norm));
      const cos = (a: number[], b: number[]) => {
        let dot = 0;
        let na = 0;
        let nb = 0;
        for (let i = 0; i < a.length; i++) {
          dot += a[i] * b[i];
          na += a[i] * a[i];
          nb += b[i] * b[i];
        }
        return na && nb ? dot / Math.sqrt(na * nb) : 0;
      };
      const P = vectors.slice(0, predNames.length);
      const T = vectors.slice(predNames.length);
      return P.map((p) => T.map((t) => Math.round(cos(p, t) * 1000) / 1000));
    } catch {
      return undefined;
    }
  }

  private static readonly CLIENT_MAX_DIMENSION = 1568;
  private static readonly CLIENT_JPEG_QUALITY = 80;
  private static sharpModule: Promise<any> | null = null;

  private static async downscaleLikeClients(bytes: Buffer, mime: string): Promise<{ bytes: Buffer; mime: string }> {
    try {
      // sharp is a transitive dependency of next; load lazily so the runner still works without it.
      this.sharpModule ??= import('sharp').then((m) => m.default ?? m).catch(() => null);
      const sharp = await this.sharpModule;
      if (!sharp) return { bytes, mime };
      const img = sharp(bytes, { failOn: 'none' }).rotate(); // honour EXIF orientation like the clients
      const meta = await img.metadata();
      const long = Math.max(meta.width ?? 0, meta.height ?? 0);
      if (long <= this.CLIENT_MAX_DIMENSION) return { bytes, mime };
      const out = await img
        .resize({ width: this.CLIENT_MAX_DIMENSION, height: this.CLIENT_MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: this.CLIENT_JPEG_QUALITY })
        .toBuffer();
      return { bytes: out, mime: 'image/jpeg' };
    } catch {
      return { bytes, mime };
    }
  }

  /** Run one golden record through parse + grounding → an EvalCase (or null if the image fails). */
  static async runOne(
    g: GoldenRecord,
    opts: RunOptions = {},
  ): Promise<{ evalCase: EvalCase | null; failed: boolean; error?: string }> {
    const img = await this.fetchImage(g.imageUri);
    if (!img) {
      console.warn(`[eval-runner] skipped ${g.id}: image fetch failed (${g.imageUri})`);
      return { evalCase: null, failed: false, error: 'image_fetch' };
    }

    const parseOpts: ParsePhotoOptions | undefined = opts.model
      ? { model: opts.model, fallbackModel: null, bypassCache: true, bypassQuota: true, promptVariant: opts.promptVariant, grounding: opts.grounding }
      : opts.promptVariant || opts.grounding
        ? { bypassCache: true, bypassQuota: true, promptVariant: opts.promptVariant, grounding: opts.grounding }
        : { bypassQuota: true };

    let parsed;
    try {
      parsed = await NutritionIntelligenceService.parsePhotoWithStats(
        EVAL_USER_ID,
        [{ bytes: img.bytes, mimeType: img.mime }],
        null,
        parseOpts,
      );
    } catch (err: any) {
      console.warn(`[eval-runner] parse failed ${g.id}: ${err?.message}`);
      return { evalCase: null, failed: true, error: String(err?.message ?? err) };
    }

    const { draft } = parsed;
    // DTO -> PhotoParseResult (the scorer's expected shape).
    const modelOutput: PhotoParseResult = {
      items: draft.items,
      overallConfidence: draft.overallConfidence,
      notes: draft.notes,
    };

    // Stage 4 from the real grounding path: grounded items carry matchedFoodId and DB density.
    const dbMatches = draft.items.map((it) => it.matchedFoodId != null);
    // Prefer the matched row's own density (side channel from the grounding step); the item's
    // final density equals it only when grounding replaced the model's macros.
    const groundedKcalPer100g =
      parsed.dbKcalPer100g && parsed.dbKcalPer100g.length === draft.items.length
        ? parsed.dbKcalPer100g
        : draft.items.map((it) => (it.matchedFoodId != null && it.grams > 0 ? (it.calories / it.grams) * 100 : null));

    // Stage 1 semantic assist: embedding cosine between every predicted and truth name, so
    // "large boiled egg" can match FNDDS's "Egg, whole, boiled or poached". Best-effort.
    const nameSimilarities = await this.semanticSimilarities(
      draft.items.map((it) => it.name),
      g.groundTruth.items.map((it) => it.name),
    );

    return {
      failed: false,
      evalCase: {
        golden: g,
        modelOutput,
        dbMatches,
        groundedKcalPer100g,
        nameSimilarities,
        rawItems: parsed.rawItems,
        latencyMs: parsed.latencyMs,
        inputTokens: parsed.inputTokens,
        outputTokens: parsed.outputTokens,
        model: parsed.model,
      },
    };
  }

  /**
   * Run the full golden set and produce the scored report. Sequential by default to respect the
   * per-user parse cost cap + avoid hammering the gateway; pass concurrency>1 to parallelize.
   */
  static async run(goldenSetIn: GoldenRecord[], opts: RunOptions = {}): Promise<EvalReport> {
    const concurrency = Math.max(1, opts.concurrency ?? 1);
    const goldenSet = opts.limit ? goldenSetIn.slice(0, opts.limit) : goldenSetIn;
    const cases: EvalCase[] = [];
    const datasetVersion = goldenSet[0]?.datasetVersion ?? 'unknown';
    let parseFailures = 0;
    const failures: Array<{ id: string; error: string }> = [];

    for (let i = 0; i < goldenSet.length; i += concurrency) {
      const slice = goldenSet.slice(i, i + concurrency);
      const results = await Promise.all(slice.map((g) => this.runOne(g, opts)));
      results.forEach((r, j) => {
        if (r.evalCase) cases.push(r.evalCase);
        if (r.failed) {
          parseFailures++;
          failures.push({ id: slice[j].id, error: r.error ?? 'unknown' });
        }
      });
      const done = Math.min(i + concurrency, goldenSet.length);
      opts.onProgress?.(done, goldenSet.length);
      if (!opts.onProgress) console.log(`[eval-runner] processed ${done}/${goldenSet.length}`);
    }

    if (cases.length === 0) {
      throw new Error('no eval cases produced (all images failed or parse unavailable — check AI_GATEWAY_API_KEY)');
    }

    const run = this.runStats(cases, goldenSet.length, parseFailures, opts);
    const report = buildReport(cases, datasetVersion, run);

    if (opts.outDir) this.persist(report, cases, failures, opts);
    return report;
  }

  /**
   * Re-score a persisted `.cases.json` (captured model outputs) with the CURRENT scorer — no
   * model calls. Used after a scorer change so older bake-off runs stay comparable. The
   * semantic name matrix is (re)computed when missing (one embedding call per case).
   */
  static async rescore(
    casesPath: string,
    goldenSet: GoldenRecord[],
    opts: { outDir?: string } = {},
  ): Promise<EvalReport> {
    const saved = JSON.parse(readFileSync(casesPath, 'utf8')) as {
      model?: string;
      promptVariant?: string | null;
      grounding?: GroundingMode | null;
      datasetVersion?: string;
      failures?: Array<{ id: string; error: string }>;
      cases: Array<Omit<EvalCase, 'golden'> & { id: string }>;
    };
    const byId = new Map(goldenSet.map((g) => [g.id, g]));
    const cases: EvalCase[] = [];
    for (const c of saved.cases) {
      const golden = byId.get(c.id);
      if (!golden) continue;
      const nameSimilarities =
        c.nameSimilarities ??
        (await this.semanticSimilarities(
          c.modelOutput.items.map((it) => it.name),
          golden.groundTruth.items.map((it) => it.name),
        ));
      cases.push({ ...c, golden, nameSimilarities, model: c.model ?? saved.model });
    }
    const attempted = cases.length + (saved.failures?.length ?? 0);
    const runOpts: RunOptions = { model: saved.model, promptVariant: saved.promptVariant ?? undefined, grounding: saved.grounding ?? undefined, outDir: opts.outDir };
    const run = this.runStats(cases, attempted, saved.failures?.length ?? 0, runOpts);
    const report = buildReport(cases, saved.datasetVersion ?? goldenSet[0]?.datasetVersion ?? 'unknown', run);
    if (opts.outDir) this.persist(report, cases, saved.failures ?? [], runOpts);
    return report;
  }

  private static runStats(cases: EvalCase[], attempted: number, parseFailures: number, opts: RunOptions): EvalRunStats {
    const model = cases[0]?.model ?? opts.model ?? 'production';
    const lat = cases.map((c) => c.latencyMs).filter((x): x is number => typeof x === 'number').sort((a, b) => a - b);
    const pct = (p: number) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(p * lat.length))] : null);
    const inTok = cases.map((c) => c.inputTokens).filter((x): x is number => typeof x === 'number');
    const outTok = cases.map((c) => c.outputTokens).filter((x): x is number => typeof x === 'number');
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const price = PRICE_TABLE[model];
    let costUsdTotal: number | null = null;
    if (price && inTok.length && outTok.length) {
      costUsdTotal =
        (inTok.reduce((a, b) => a + b, 0) * price[0] + outTok.reduce((a, b) => a + b, 0) * price[1]) / 1_000_000;
    }
    return {
      model,
      promptVariant: opts.promptVariant ?? null,
      grounding: opts.grounding ?? null,
      attempted,
      parsed: cases.length,
      parseFailures,
      latencyMsP50: pct(0.5),
      latencyMsP95: pct(0.95),
      inputTokensMean: mean(inTok),
      outputTokensMean: mean(outTok),
      costUsdTotal,
      costUsdPerParse: costUsdTotal != null && cases.length ? costUsdTotal / cases.length : null,
    };
  }

  /** Persist the report and the raw per-case outputs so scoring can be re-run offline. */
  private static persist(
    report: EvalReport,
    cases: EvalCase[],
    failures: Array<{ id: string; error: string }>,
    opts: RunOptions,
  ): void {
    const dir = path.resolve(opts.outDir!);
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const slug = (report.run?.model ?? 'production').replace(/[^a-z0-9.]+/gi, '_');
    const variant = `${opts.promptVariant ? `-${opts.promptVariant}` : ''}${opts.grounding ? `-ground_${opts.grounding}` : ''}`;
    const base = `${stamp}-${slug}${variant}`;
    writeFileSync(path.join(dir, `${base}.report.json`), JSON.stringify(report, null, 2));
    writeFileSync(
      path.join(dir, `${base}.cases.json`),
      JSON.stringify(
        {
          model: report.run?.model,
          promptVariant: opts.promptVariant ?? null,
          grounding: opts.grounding ?? null,
          datasetVersion: report.datasetVersion,
          failures,
          cases: cases.map((c) => ({
            id: c.golden.id,
            modelOutput: c.modelOutput,
            dbMatches: c.dbMatches,
            groundedKcalPer100g: c.groundedKcalPer100g,
            nameSimilarities: c.nameSimilarities,
            rawItems: c.rawItems,
            latencyMs: c.latencyMs,
            inputTokens: c.inputTokens,
            outputTokens: c.outputTokens,
          })),
        },
        null,
        2,
      ),
    );
    console.log(`[eval-runner] wrote ${path.join(dir, base)}.{report,cases}.json`);
  }
}
