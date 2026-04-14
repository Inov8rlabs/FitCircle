import { type NextRequest, NextResponse } from 'next/server';

import { CHALLENGE_TEMPLATES, getTemplatesByCategory } from '@/lib/data/challenge-templates';

/**
 * GET /api/fitcircles/[id]/challenges/templates
 * Get all available challenge templates
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const category = url.searchParams.get('category') || 'all';

  const templates = getTemplatesByCategory(category);

  return NextResponse.json({
    success: true,
    data: {
      templates,
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
