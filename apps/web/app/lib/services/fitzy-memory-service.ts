/**
 * Fitzy memory (Pro) + the growth-nudge stamp (docs/FITZY_V2_SPEC.md §3.6, §4).
 *
 * After each Pro chat turn a background Haiku call extracts ≤ 2 NEW facts the
 * user stated explicitly about themselves (goals, food/exercise preferences,
 * schedule/routine, equipment, dislikes). Strict exclusions are enforced in
 * code, not trusted to the model: health conditions, medications, injuries,
 * body measurements, weight, and anything about other people are never stored.
 * Every item also passes the Fitzy output guard. Cap 25 (oldest dropped).
 */
import { randomUUID } from 'node:crypto';

import { chatModel, generateWithFallback, systemMessages, type ModelCall } from '../fitzy/models';
import { createAdminSupabase } from '../supabase-admin';
import type { FitzyMemoryItem, MemoryKind } from '../types/fitzy';

export const MEMORY_CAP = 25;
export const MEMORY_PER_TURN = 2;
const KINDS: readonly MemoryKind[] = ['goal', 'preference', 'routine', 'constraint'];

/** Never stored: health, meds, injuries, measurements, weight, other people. */
const EXCLUDED: RegExp[] = [
  /\b(diabet\w*|asthma|cancer|depress\w*|anxiety|adhd|autis\w*|pcos|thyroid\w*|blood\s+pressure|hypertens\w*|cholesterol|arthritis|celiac|crohn\w*|ibs|migraine\w*|pregnan\w*|menopaus\w*|disorder|anorexi\w*|bulimi\w*|binge\w*|condition|diagnos\w*|illness|disease|syndrome|allerg\w*)\b/i,
  /\b(medicat\w*|meds?|pills?|insulin|prescri\w*|ozempic|wegovy|semaglutide|metformin|statins?|antidepress\w*|supplement\w*\s+for)\b/i,
  /\b(injur\w*|pain|painful|hurts?|sprain\w*|strain\w*|torn|tear|fractur\w*|surgery|rehab\w*|physio\w*|knee|back|shoulder|hip|ankle|wrist)\b/i,
  /\b(weigh\w*|kg|kgs|kilos?|lbs?|pounds?|stone|bmi|body[\s-]?fat|fat\s+mass|muscle\s+mass|waist|hips?\s+measure\w*|inches|cm|centimet\w*|height|tall|size\s+\d+|dress\s+size)\b/i,
  /\b(my\s+(?:wife|husband|partner|boyfriend|girlfriend|son|daughter|kids?|children|mom|mum|dad|mother|father|parents?|friend|friends|boss|coworker|colleague|brother|sister|family|roommate)|\bhe\b|\bshe\b|\bhis\b|\bher\b|\bthey\b|\btheir\b)/i,
];

export function isExcludedMemory(text: string): boolean {
  return EXCLUDED.some((re) => re.test(text));
}

export const EXTRACT_PROMPT = [
  'You extract durable facts a fitness coach should remember about the USER, from one chat turn.',
  'Only facts the user stated explicitly about THEMSELVES: goals, food or exercise preferences, dislikes,',
  'schedule/routine, available equipment or time. At most 2 NEW items not already known.',
  'NEVER extract health conditions, diagnoses, medications, injuries, pain, body measurements, weight,',
  'body composition, or anything about other people. If nothing qualifies, return an empty list.',
  'Each item: short third-person-free phrase, ≤ 100 characters, e.g. "Prefers morning workouts",',
  '"Vegetarian, loves spicy food", "Has dumbbells at home", "Goal: run a 5K in spring".',
  'Reply with ONLY JSON: {"items":[{"text":"…","kind":"goal|preference|routine|constraint"}]}',
].join('\n');

/** The background extraction call for one Pro turn. */
export function extractRequest(known: FitzyMemoryItem[], userMessage: string, answer: string): ModelCall & { primary: string } {
  const list = known.map((i) => `- ${i.text}`).join('\n') || '(none)';
  return {
    primary: chatModel(),
    system: systemMessages(EXTRACT_PROMPT, `ALREADY KNOWN:\n${list}`),
    messages: [{ role: 'user', content: `USER SAID:\n${userMessage}\n\nCOACH REPLIED:\n${answer.slice(0, 1500)}` }],
    maxOutputTokens: 200,
    thinking: false,
  };
}

/** First {...} block of the model reply, or null when there is none / it doesn't parse. */
export function parseExtraction(text: string): unknown {
  try {
    const m = text.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch {
    return null;
  }
}

interface MemoryRow {
  user_id: string;
  items: FitzyMemoryItem[] | null;
  last_growth_nudge_at: string | null;
}

export class FitzyMemoryService {
  static async row(userId: string): Promise<MemoryRow | null> {
    const { data, error } = await createAdminSupabase().from('fitzy_memory').select('*').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return (data as MemoryRow | null) ?? null;
  }

  static async items(userId: string): Promise<FitzyMemoryItem[]> {
    return (await this.row(userId))?.items ?? [];
  }

  private static async save(userId: string, patch: Partial<MemoryRow>): Promise<void> {
    const { error } = await createAdminSupabase()
      .from('fitzy_memory')
      .upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) throw error;
  }

  static async lastGrowthNudgeAt(userId: string): Promise<string | null> {
    return (await this.row(userId))?.last_growth_nudge_at ?? null;
  }

  static async stampGrowthNudge(userId: string, at: Date = new Date()): Promise<void> {
    const existing = await this.row(userId);
    await this.save(userId, { items: existing?.items ?? [], last_growth_nudge_at: at.toISOString() });
  }

  static async remove(userId: string, itemId: string): Promise<FitzyMemoryItem[]> {
    const existing = await this.row(userId);
    const items = (existing?.items ?? []).filter((i) => i.id !== itemId);
    await this.save(userId, { items, last_growth_nudge_at: existing?.last_growth_nudge_at ?? null });
    return items;
  }

  static async clear(userId: string): Promise<void> {
    const existing = await this.row(userId);
    await this.save(userId, { items: [], last_growth_nudge_at: existing?.last_growth_nudge_at ?? null });
  }

  /** Validate model output into storable items (exclusions, guard, kinds, length, dedupe). */
  static sanitize(raw: unknown, existing: FitzyMemoryItem[], guard: (text: string) => boolean): Array<{ text: string; kind: MemoryKind }> {
    const list = Array.isArray((raw as any)?.items) ? (raw as any).items : [];
    const known = new Set(existing.map((i) => i.text.toLowerCase().replace(/\W+/g, ' ').trim()));
    const out: Array<{ text: string; kind: MemoryKind }> = [];
    for (const it of list) {
      const text = typeof it?.text === 'string' ? it.text.replace(/\s+/g, ' ').trim() : '';
      const kind = KINDS.includes(it?.kind) ? (it.kind as MemoryKind) : null;
      if (!text || !kind || text.length > 120) continue;
      if (isExcludedMemory(text) || guard(text)) continue;
      const key = text.toLowerCase().replace(/\W+/g, ' ').trim();
      if (known.has(key)) continue;
      known.add(key);
      out.push({ text, kind });
      if (out.length >= MEMORY_PER_TURN) break;
    }
    return out;
  }

  /** Background extraction after a Pro turn. Never throws. */
  static async extract(userId: string, userMessage: string, answer: string, guard: (text: string) => boolean): Promise<FitzyMemoryItem[]> {
    try {
      const existing = await this.row(userId);
      const items = existing?.items ?? [];
      const res = await generateWithFallback(extractRequest(items, userMessage, answer));
      const parsed = parseExtraction(res.text);
      const fresh = this.sanitize(parsed, items, guard);
      if (!fresh.length) return items;
      const now = new Date().toISOString();
      const next = [...items, ...fresh.map((f) => ({ id: randomUUID(), text: f.text, kind: f.kind, createdAt: now }))].slice(-MEMORY_CAP);
      await this.save(userId, { items: next, last_growth_nudge_at: existing?.last_growth_nudge_at ?? null });
      return next;
    } catch (err) {
      console.error('[FitzyMemory] extraction failed (non-fatal):', (err as any)?.message ?? err);
      return [];
    }
  }
}
