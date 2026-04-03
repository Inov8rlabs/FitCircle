import { createAdminSupabase } from '../supabase-admin';

// ============================================================================
// TYPES
// ============================================================================

export type ShareCardType =
  | 'milestone'
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
// TEMPLATE CONFIG
// ============================================================================

const CARD_TEMPLATES: Record<ShareCardType, { templateName: string; title: string }> = {
  milestone: { templateName: 'milestone_achievement', title: 'Milestone Achieved!' },
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
    cardData: ShareCardData
  ): Promise<ShareCardRow> {
    const supabaseAdmin = createAdminSupabase();

    console.log(`[ShareCardService.generateCard] Generating ${cardType} card for user ${userId}`);

    const template = CARD_TEMPLATES[cardType];
    if (!template) {
      throw new Error(`Unknown card type: ${cardType}`);
    }

    // Generate the card image URL (OG-image style endpoint)
    const imageUrl = this.buildCardImageUrl(cardType, cardData);

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
    cardData: ShareCardData
  ): string {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://fitcircle.app';
    const params = new URLSearchParams({
      type: cardType,
      data: Buffer.from(JSON.stringify(cardData)).toString('base64'),
    });

    return `${baseUrl}/api/og/share-card?${params.toString()}`;
  }
}
