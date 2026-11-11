import { embed, embedMany } from 'ai';

import { aiCallOptions } from './ai/gateway-options';
import { type AiUsageContext, trackAiCall } from './ai/usage';

/**
 * Food-name embeddings via the Vercel AI Gateway. text-embedding-3-small → 1536 dims:
 * cheap (~$0.02/1M tokens), strong for short food names, and within pgvector's HNSW
 * dimension limit. Must match the `vector(1536)` column in migration 068 — if you change
 * the model/dims, change the column too and re-embed.
 */
export const FOOD_EMBEDDING_MODEL = 'openai/text-embedding-3-small';
export const FOOD_EMBEDDING_DIMS = 1536;

/** `usage`: who/what the embedding serves (gateway tags + ai_usage_events; lib/ai/usage.ts). */
export async function embedText(text: string, usage?: AiUsageContext): Promise<number[]> {
  const { embedding } = await trackAiCall(usage, FOOD_EMBEDDING_MODEL, () => embed({ model: FOOD_EMBEDDING_MODEL, value: text, ...aiCallOptions(usage) }));
  return embedding;
}

export async function embedTexts(texts: string[], usage?: AiUsageContext): Promise<number[][]> {
  if (texts.length === 0) return [];
  const { embeddings } = await trackAiCall(usage, FOOD_EMBEDDING_MODEL, () => embedMany({ model: FOOD_EMBEDDING_MODEL, values: texts, ...aiCallOptions(usage) }));
  return embeddings;
}

/** pgvector literal form: `[0.1,0.2,...]` (bound as a parameter, cast `$n::vector` in SQL). */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}
