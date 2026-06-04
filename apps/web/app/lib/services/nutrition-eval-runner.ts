import { readFileSync } from 'fs';

import { FoodsService } from './foods-service';
import { NutritionIntelligenceService } from './nutrition-intelligence-service';
import { buildReport } from './nutrition-eval';
import type { EvalReport, GoldenRecord, EvalCase } from '../types/nutrition-eval';
import type { PhotoParseResult } from '../types/nutrition';

/**
 * NutritionEvalRunner — drives golden images through the LIVE parse pipeline and scores them
 * (PRD §8.3). The scorers (nutrition-eval.ts) are pure; this is the side-effectful half:
 *   golden image -> fetch bytes -> parsePhoto (AI Gateway) -> FoodsService.search per item
 *   -> EvalCase -> buildReport.
 *
 * Needs AI_GATEWAY_API_KEY (live LLM) + a foods table populated for Stage-4 DB matching.
 * Run via scripts/run-nutrition-eval.mjs.
 */

// A system user id used only for parse cost-accounting + search scoping during the eval.
const EVAL_USER_ID = '00000000-0000-0000-0000-0000000000e7';

export class NutritionEvalRunner {
  /** Load a golden dataset JSON file (array of GoldenRecord). */
  static loadGoldenSet(path: string): GoldenRecord[] {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(raw)) throw new Error('golden set must be a JSON array of GoldenRecord');
    return raw as GoldenRecord[];
  }

  /** Fetch the image bytes for a golden record (http(s) URL or local file path). */
  private static async fetchImage(imageUri: string): Promise<{ bytes: Buffer; mime: string } | null> {
    try {
      if (/^https?:\/\//.test(imageUri)) {
        const res = await fetch(imageUri);
        if (!res.ok) return null;
        const mime = res.headers.get('content-type') ?? 'image/jpeg';
        return { bytes: Buffer.from(await res.arrayBuffer()), mime };
      }
      // local path
      return { bytes: readFileSync(imageUri), mime: imageUri.endsWith('.png') ? 'image/png' : 'image/jpeg' };
    } catch {
      return null;
    }
  }

  /** Run one golden record through parse + DB-match → an EvalCase (or null if the image fails). */
  static async runOne(g: GoldenRecord): Promise<EvalCase | null> {
    const img = await this.fetchImage(g.imageUri);
    if (!img) {
      console.warn(`[eval-runner] skipped ${g.id}: image fetch failed (${g.imageUri})`);
      return null;
    }

    let draft;
    try {
      draft = await NutritionIntelligenceService.parsePhoto(EVAL_USER_ID, img.bytes, img.mime);
    } catch (err: any) {
      console.warn(`[eval-runner] skipped ${g.id}: parsePhoto failed (${err?.message})`);
      return null;
    }

    // DTO -> PhotoParseResult (the scorer's expected shape).
    const modelOutput: PhotoParseResult = {
      items: draft.items,
      overallConfidence: draft.overallConfidence,
      notes: draft.notes,
    };

    // Stage 4: does each predicted item resolve to a foods row? (FoodsService.search returns [] when empty.)
    const dbMatches: boolean[] = [];
    for (const item of modelOutput.items) {
      try {
        const hits = await FoodsService.search(EVAL_USER_ID, { query: item.name, limit: 1 });
        dbMatches.push(hits.length > 0);
      } catch {
        dbMatches.push(false);
      }
    }

    return { golden: g, modelOutput, dbMatches };
  }

  /**
   * Run the full golden set and produce the scored report. Sequential by default to respect the
   * per-user parse cost cap + avoid hammering the gateway; pass concurrency>1 to parallelize.
   */
  static async run(goldenSet: GoldenRecord[], opts?: { concurrency?: number }): Promise<EvalReport> {
    const concurrency = Math.max(1, opts?.concurrency ?? 1);
    const cases: EvalCase[] = [];
    const datasetVersion = goldenSet[0]?.datasetVersion ?? 'unknown';

    for (let i = 0; i < goldenSet.length; i += concurrency) {
      const slice = goldenSet.slice(i, i + concurrency);
      const results = await Promise.all(slice.map((g) => this.runOne(g)));
      for (const c of results) if (c) cases.push(c);
      console.log(`[eval-runner] processed ${Math.min(i + concurrency, goldenSet.length)}/${goldenSet.length}`);
    }

    if (cases.length === 0) {
      throw new Error('no eval cases produced (all images failed or parse unavailable — check AI_GATEWAY_API_KEY)');
    }

    return buildReport(cases, datasetVersion);
  }
}
