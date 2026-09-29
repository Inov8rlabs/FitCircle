import { createAdminSupabase } from '../supabase-admin';

// ============================================================================
// TYPES
// ============================================================================

export type ShareCardType =
  | 'milestone'
  | 'streak_milestone'
  | 'challenge_complete'
  | 'perfect_week'
  | 'momentum_flame'
  | 'circle_boost';

export interface MilestoneCardData {
  milestoneName: string;
  dayCount: number;
  badgeEmoji: string;
  currentStreak: number;
}

export interface ChallengeCompleteCardData {
  challengeName: string;
  goalAmount: number;
  unit: string;
  duration: number;
  completedAt: string;
}

export interface PerfectWeekCardData {
  weekStart: string;
  weekEnd: string;
  circleNames: string[];
}

export interface MomentumFlameCardData {
  currentMomentum: number;
  flameLevel: number;
  bestMomentum: number;
}

export interface CircleBoostCardData {
  circleName: string;
  multiplier: number;
  checkedInCount: number;
  totalMembers: number;
}

export type ShareCardData =
  | MilestoneCardData
  | ChallengeCompleteCardData
  | PerfectWeekCardData
  | MomentumFlameCardData
  | CircleBoostCardData;

export interface ShareCardRow {
  id: string;
  user_id: string;
  card_type: ShareCardType;
  template_name: string;
  card_data: ShareCardData;
  image_url: string | null;
  shared_count: number;
  created_at: string;
  expires_at: string;
}

// ============================================================================
// CARD DATA NORMALISATION
// ============================================================================

/**
 * The mobile apps send `card_data` as a flat map of snake_case keys with STRING
 * values (`{ "milestone_name": "Week Warrior", "days": "7" }`), while the card
 * types above (and the renderer) are camelCase with numbers. Extra spellings a
 * client uses for a canonical field, per card type.
 */
const CARD_DATA_ALIASES: Record<ShareCardType, Record<string, string>> = {
  milestone: { days: 'dayCount', badge: 'badgeEmoji' },
  streak_milestone: { days: 'streakDays', badgeEmoji: 'badge' },
  challenge_complete: { goalLabel: 'goal', durationDays: 'duration' },
  perfect_week: {},
  momentum_flame: { level: 'flameLevel', momentum: 'currentMomentum' },
  circle_boost: { checkedIn: 'checkedInCount', total: 'totalMembers' },
};

/** Canonical fields that are numbers. Everything else is left as sent. */
const NUMERIC_CARD_FIELDS = new Set([
  'dayCount',
  'currentStreak',
  'streakDays',
  'goalAmount',
  'duration',
  'rank',
  'weekNumber',
  'currentMomentum',
  'flameLevel',
  'bestMomentum',
  'multiplier',
  'checkedInCount',
  'totalMembers',
]);

function snakeToCamel(key: string): string {
  return key.replace(/[_-]+([a-zA-Z0-9])/g, (_match, char: string) => char.toUpperCase());
}

/**
 * "7" -> 7, "2.0x" -> 2, "1,250" -> 1250. Anything that is not clearly a number
 * (with an optional short unit suffix) comes back undefined.
 */
function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const match = value.trim().match(/^(-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?)\s*[a-zA-Z%×]{0,3}$/);
  if (!match) return undefined;
  const parsed = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Card data as the renderer needs it: every key the client sent is kept as it
 * was, and the canonical camelCase fields are added next to them (numbers
 * coerced from numeric strings). A canonical key the client already sent wins
 * over an alias.
 *
 * Used ONLY to build the rendered image. The stored `card_data` (and therefore
 * the API response) stays exactly what the client sent: iOS decodes it as
 * `[String: String]` and reads its own snake_case keys back out of it.
 */
export function normalizeShareCardData(
  cardType: ShareCardType,
  raw: unknown
): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const aliases = CARD_DATA_ALIASES[cardType] ?? {};

  const canonical: Record<string, unknown> = {};
  const put = (key: string, value: unknown, override: boolean) => {
    if (value === undefined || value === null) return;
    if (!override && canonical[key] !== undefined) return;
    canonical[key] = NUMERIC_CARD_FIELDS.has(key) ? (toNumber(value) ?? value) : value;
  };

  // 1. Aliases and snake_case spellings fill the canonical key...
  for (const [key, value] of Object.entries(source)) {
    const camel = snakeToCamel(key);
    put(aliases[camel] ?? aliases[key] ?? camel, value, false);
  }
  // 2. ...but a key that already IS canonical has the last word.
  for (const [key, value] of Object.entries(source)) {
    if (snakeToCamel(key) === key && !aliases[key]) put(key, value, true);
  }

  // "50 reps" -> goalAmount 50 + unit "reps" (the apps send one label).
  if (cardType === 'challenge_complete' && typeof canonical.goal === 'string') {
    const label = canonical.goal.trim().match(/^(\d+(?:[.,]\d+)?)\s*(.*)$/);
    if (label) {
      if (canonical.goalAmount === undefined) {
        const amount = Number(label[1].replace(',', '.'));
        if (Number.isFinite(amount)) canonical.goalAmount = amount;
      }
      if (canonical.unit === undefined && label[2]) canonical.unit = label[2];
    }
  }

  // The day count of a momentum milestone doubles as the streak when the
  // client sent only one of them.
  if (cardType === 'milestone') {
    if (canonical.dayCount === undefined && canonical.currentStreak !== undefined) {
      canonical.dayCount = canonical.currentStreak;
    }
    if (canonical.dayCount === undefined && canonical.currentMomentum !== undefined) {
      canonical.dayCount = toNumber(canonical.currentMomentum) ?? canonical.currentMomentum;
    }
  }

  // Original keys first so nothing a renderer already reads goes missing.
  return { ...source, ...canonical };
}

// ============================================================================
// TEMPLATE CONFIG
// ============================================================================

const CARD_TEMPLATES: Record<ShareCardType, { templateName: string; title: string }> = {
  milestone: { templateName: 'milestone_achievement', title: 'Milestone Achieved!' },
  streak_milestone: { templateName: 'streak_milestone_flame', title: 'Streak Milestone!' },
  challenge_complete: { templateName: 'challenge_victory', title: 'Challenge Complete!' },
  perfect_week: { templateName: 'perfect_week_glow', title: 'Perfect Week!' },
  momentum_flame: { templateName: 'momentum_fire', title: 'On Fire!' },
  circle_boost: { templateName: 'circle_boost_card', title: 'Circle Boost!' },
};

// ============================================================================
// SERVICE
// ============================================================================

export class ShareCardService {
  // ============================================================================
  // GENERATE CARD
  // ============================================================================

  /**
   * Generate a new share card for the user.
   * Creates the database record and generates an HTML-based card image URL.
   */
  static async generateCard(
    userId: string,
    cardType: ShareCardType,
    cardData: ShareCardData | Record<string, unknown>
  ): Promise<ShareCardRow> {
    const supabaseAdmin = createAdminSupabase();

    console.log(`[ShareCardService.generateCard] Generating ${cardType} card for user ${userId}`);

    const template = CARD_TEMPLATES[cardType];
    if (!template) {
      throw new Error(`Unknown card type: ${cardType}`);
    }

    // Generate the card image URL (OG-image style endpoint). The renderer gets
    // the normalised data; `card_data` below is stored exactly as it was sent.
    const imageUrl = this.buildCardImageUrl(cardType, normalizeShareCardData(cardType, cardData));

    const { data, error } = await supabaseAdmin
      .from('share_cards')
      .insert({
        user_id: userId,
        card_type: cardType,
        template_name: template.templateName,
        card_data: cardData,
        image_url: imageUrl,
      })
      .select()
      .single();

    if (error) {
      console.error(`[ShareCardService.generateCard] Insert error:`, error);
      throw error;
    }

    console.log(`[ShareCardService.generateCard] Card created: ${data.id}`);
    return data as ShareCardRow;
  }

  // ============================================================================
  // GET CARD
  // ============================================================================

  /**
   * Get a single share card by ID.
   */
  static async getCard(cardId: string): Promise<ShareCardRow | null> {
    const supabaseAdmin = createAdminSupabase();

    const { data, error } = await supabaseAdmin
      .from('share_cards')
      .select('*')
      .eq('id', cardId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }

    return data as ShareCardRow;
  }

  // ============================================================================
  // USER CARDS
  // ============================================================================

  /**
   * Get recent share cards for a user.
   */
  static async getUserCards(userId: string, limit: number = 10): Promise<ShareCardRow[]> {
    const supabaseAdmin = createAdminSupabase();

    const { data, error } = await supabaseAdmin
      .from('share_cards')
      .select('*')
      .eq('user_id', userId)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error(`[ShareCardService.getUserCards] Error:`, error);
      throw error;
    }

    return (data || []) as ShareCardRow[];
  }

  // ============================================================================
  // SHARE TRACKING
  // ============================================================================

  /**
   * Increment the shared_count for a card.
   */
  static async incrementShareCount(cardId: string, userId: string): Promise<void> {
    const supabaseAdmin = createAdminSupabase();

    // Fetch current count and verify ownership
    const { data: card, error: fetchError } = await supabaseAdmin
      .from('share_cards')
      .select('shared_count, user_id')
      .eq('id', cardId)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') throw new Error('Card not found');
      throw fetchError;
    }

    if (card.user_id !== userId) {
      throw new Error('Unauthorized');
    }

    const { error } = await supabaseAdmin
      .from('share_cards')
      .update({ shared_count: (card.shared_count || 0) + 1 })
      .eq('id', cardId);

    if (error) {
      console.error(`[ShareCardService.incrementShareCount] Error:`, error);
      throw error;
    }
  }

  // ============================================================================
  // CLEANUP
  // ============================================================================

  /**
   * Remove expired share cards. Called by cron job.
   */
  static async cleanupExpiredCards(): Promise<number> {
    const supabaseAdmin = createAdminSupabase();

    const now = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from('share_cards')
      .delete()
      .lt('expires_at', now)
      .select('id');

    if (error) {
      console.error(`[ShareCardService.cleanupExpiredCards] Error:`, error);
      throw error;
    }

    const deletedCount = data?.length || 0;
    console.log(`[ShareCardService.cleanupExpiredCards] Cleaned up ${deletedCount} expired cards`);
    return deletedCount;
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  /**
   * Build a server-side card image URL using an OG-image style endpoint.
   * The card is rendered as HTML/CSS and can be captured as an image by the client.
   */
  private static buildCardImageUrl(
    cardType: ShareCardType,
    cardData: ShareCardData | Record<string, unknown>
  ): string {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://fitcircle.app';
    const params = new URLSearchParams({
      type: cardType,
      data: Buffer.from(JSON.stringify(cardData)).toString('base64'),
    });

    return `${baseUrl}/api/og/share-card?${params.toString()}`;
  }
}
