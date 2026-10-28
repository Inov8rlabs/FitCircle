import { type NextRequest, NextResponse } from 'next/server';

import { CHALLENGE_TEMPLATES, getTemplatesByCategory } from '@/lib/data/challenge-templates';
import { iconCompatFor } from '@/lib/design/icon-compat';

/**
 * GET /api/fitcircles/[id]/challenges/templates
 * Get all available challenge templates.
 *
 * Each template carries `icon_key` (an icon key) for every client. `icon` is the
 * legacy emoji for shipped apps (≤ 1.1.x); X-App-Version ≥ 1.2.0 gets the key
 * in `icon` as well (applyIconCompat).
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const category = url.searchParams.get('category') || 'all';

  const templates = getTemplatesByCategory(category);

  return NextResponse.json({
    success: true,
    data: {
      templates: iconCompatFor(request, templates),
      categories: [
        { id: 'all', name: 'All', count: CHALLENGE_TEMPLATES.length },
        { id: 'strength', name: 'Strength', count: CHALLENGE_TEMPLATES.filter(t => t.category === 'strength').length },
        { id: 'cardio', name: 'Cardio', count: CHALLENGE_TEMPLATES.filter(t => t.category === 'cardio').length },
        { id: 'flexibility', name: 'Flexibility', count: CHALLENGE_TEMPLATES.filter(t => t.category === 'flexibility').length },
        { id: 'wellness', name: 'Wellness', count: CHALLENGE_TEMPLATES.filter(t => t.category === 'wellness').length },
        { id: 'custom', name: 'Custom', count: CHALLENGE_TEMPLATES.filter(t => t.category === 'custom').length },
      ],
    },
    error: null,
  });
}
