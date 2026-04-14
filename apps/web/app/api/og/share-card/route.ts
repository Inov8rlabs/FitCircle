import { type NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/og/share-card?type=milestone&data=base64encoded
 * Renders a share card as HTML for OG image generation.
 * The mobile client can screenshot this or use it as a share preview.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const cardType = searchParams.get('type');
    const dataParam = searchParams.get('data');

    if (!cardType || !dataParam) {
      return new NextResponse('Missing type or data parameter', { status: 400 });
    }

    let cardData: Record<string, unknown>;
    try {
      cardData = JSON.parse(Buffer.from(dataParam, 'base64').toString('utf-8'));
    } catch {
      return new NextResponse('Invalid data parameter', { status: 400 });
    }

    const html = renderCardHtml(cardType, cardData);

    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (error) {
    console.error('[GET /api/og/share-card] Error:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}

// ============================================================================
// CARD HTML TEMPLATES
// ============================================================================

function renderCardHtml(cardType: string, data: Record<string, unknown>): string {
  const cardContent = getCardContent(cardType, data);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=600">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 600px;
      height: 400px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .card {
      width: 560px;
      height: 360px;
      border-radius: 24px;
      padding: 40px;
      position: relative;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .card::before {
      content: '';
      position: absolute;
      top: -50%;
      right: -50%;
      width: 200%;
      height: 200%;
      border-radius: 50%;
      opacity: 0.08;
    }
    .badge { font-size: 48px; margin-bottom: 8px; }
    .title { font-size: 28px; font-weight: 700; margin-bottom: 4px; }
    .subtitle { font-size: 16px; opacity: 0.8; margin-bottom: 16px; }
    .stat { font-size: 48px; font-weight: 800; }
    .stat-label { font-size: 14px; opacity: 0.7; text-transform: uppercase; letter-spacing: 1px; }
    .footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      opacity: 0.6;
      font-size: 12px;
    }
    .brand { font-weight: 700; letter-spacing: 2px; }
    ${getCardTypeStyles(cardType)}
  </style>
</head>
<body>
  <div class="card">
    ${cardContent}
    <div class="footer">
      <span class="brand">FITCIRCLE</span>
      <span>fitcircle.app</span>
    </div>
  </div>
</body>
</html>`;
}

function getCardTypeStyles(cardType: string): string {
  const styles: Record<string, string> = {
    milestone: `
      .card { background: linear-gradient(135deg, #7c3aed 0%, #6366f1 50%, #8b5cf6 100%); }
      .card::before { background: radial-gradient(circle, #a78bfa, transparent); }
    `,
    challenge_complete: `
      .card { background: linear-gradient(135deg, #059669 0%, #10b981 50%, #34d399 100%); }
      .card::before { background: radial-gradient(circle, #6ee7b7, transparent); }
    `,
    perfect_week: `
      .card { background: linear-gradient(135deg, #0891b2 0%, #06b6d4 50%, #22d3ee 100%); }
      .card::before { background: radial-gradient(circle, #67e8f9, transparent); }
    `,
    momentum_flame: `
      .card { background: linear-gradient(135deg, #c2410c 0%, #f97316 50%, #fb923c 100%); }
      .card::before { background: radial-gradient(circle, #fdba74, transparent); }
    `,
    circle_boost: `
      .card { background: linear-gradient(135deg, #be185d 0%, #ec4899 50%, #f472b6 100%); }
      .card::before { background: radial-gradient(circle, #f9a8d4, transparent); }
    `,
  };

  return styles[cardType] || '';
}

function getCardContent(cardType: string, data: Record<string, unknown>): string {
  switch (cardType) {
    case 'milestone':
      return `
        <div>
          <div class="badge">${data.badgeEmoji || '🏆'}</div>
          <div class="title">${escapeHtml(String(data.milestoneName || 'Milestone'))}</div>
          <div class="subtitle">Momentum milestone achieved</div>
        </div>
        <div>
          <div class="stat">${data.dayCount || 0} days</div>
          <div class="stat-label">Current streak: ${data.currentStreak || 0} days</div>
        </div>
      `;

    case 'challenge_complete':
      return `
        <div>
          <div class="badge">🎯</div>
          <div class="title">Challenge Complete!</div>
          <div class="subtitle">${escapeHtml(String(data.challengeName || 'Challenge'))}</div>
        </div>
        <div>
          <div class="stat">${data.goalAmount || 0} ${escapeHtml(String(data.unit || ''))}</div>
          <div class="stat-label">Completed in ${data.duration || 0} days</div>
        </div>
      `;

    case 'perfect_week':
      return `
        <div>
          <div class="badge">⭐</div>
          <div class="title">Perfect Week!</div>
          <div class="subtitle">${escapeHtml(String(data.weekStart || ''))} - ${escapeHtml(String(data.weekEnd || ''))}</div>
        </div>
        <div>
          <div class="stat">${Array.isArray(data.circleNames) ? data.circleNames.length : 0} circles</div>
          <div class="stat-label">${Array.isArray(data.circleNames) ? data.circleNames.map(n => escapeHtml(String(n))).join(', ') : ''}</div>
        </div>
      `;

    case 'momentum_flame':
      return `
        <div>
          <div class="badge">🔥</div>
          <div class="title">On Fire!</div>
          <div class="subtitle">Momentum Level ${data.flameLevel || 1}</div>
        </div>
        <div>
          <div class="stat">${data.currentMomentum || 0} days</div>
          <div class="stat-label">Best momentum: ${data.bestMomentum || 0} days</div>
        </div>
      `;

    case 'circle_boost':
      return `
        <div>
          <div class="badge">🚀</div>
          <div class="title">Circle Boost!</div>
          <div class="subtitle">${escapeHtml(String(data.circleName || 'Circle'))}</div>
        </div>
        <div>
          <div class="stat">${data.multiplier || 1}x</div>
          <div class="stat-label">${data.checkedInCount || 0} / ${data.totalMembers || 0} members checked in</div>
        </div>
      `;

    default:
      return `<div class="title">FitCircle</div>`;
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
