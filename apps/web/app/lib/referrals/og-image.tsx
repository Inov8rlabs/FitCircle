import { ImageResponse } from 'next/og';

import { loadInvitePreview } from './load-preview';
import { inviterFirstName, rewardLine } from './web';

export const OG_SIZE = { width: 1200, height: 630 } as const;

const SUPPORTED_IMAGE = /^image\/(png|jpe?g|gif)/i;

/** Fetches a remote avatar as a data URL Satori can embed; null on any problem (we fall back to an initial). */
async function avatarDataUrl(url: string | null | undefined): Promise<string | null> {
  if (!url || !/^https:\/\//i.test(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !SUPPORTED_IMAGE.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > 1_500_000) return null;
    return `data:${type.split(';')[0]};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * The invite share card (iMessage / WhatsApp / Slack previews): inviter avatar,
 * headline, circle name, five seats (filled up to the member count) and the
 * reward line, on the brand purple→pink gradient.
 */
export async function renderInviteOgImage(code: string, ref: string | null): Promise<ImageResponse> {
  const { preview } = await loadInvitePreview(code, ref);
  const valid = preview.valid;
  const name = inviterFirstName(preview);
  const initial = (preview.inviter?.firstName?.trim()?.[0] ?? 'F').toUpperCase();
  const avatar = valid ? await avatarDataUrl(preview.inviter?.avatarUrl) : null;
  const circle = valid && preview.kind === 'circle' ? preview.circle ?? null : null;
  const filled = circle ? Math.min(5, Math.max(1, circle.memberCount)) : 1;
  const reward = valid ? rewardLine(preview.inviteeRewardDays) : null;

  const headline = !valid
    ? 'Fitness is better together'
    : circle
      ? `${name} saved you a seat`
      : `${name} saved you a seat on FitCircle`;

  const response = new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '64px 72px',
          background: 'linear-gradient(135deg, #0f0a1f 0%, #2e1065 45%, #831843 100%)',
          color: 'white',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              border: '6px solid #c084fc',
              display: 'flex',
            }}
          />
          <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: -0.5 }}>FitCircle</div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 40 }}>
          <div
            style={{
              width: 168,
              height: 168,
              borderRadius: 84,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'linear-gradient(135deg, #a855f7, #ec4899)',
              boxShadow: '0 0 0 8px rgba(255,255,255,0.12)',
              overflow: 'hidden',
              fontSize: 84,
              fontWeight: 700,
            }}
          >
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
              <img src={avatar} width={168} height={168} style={{ objectFit: 'cover' }} />
            ) : (
              initial
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 760 }}>
            <div style={{ fontSize: 60, fontWeight: 800, lineHeight: 1.05, letterSpacing: -1.5 }}>
              {truncate(headline, 48)}
            </div>
            {circle ? (
              <div style={{ fontSize: 38, color: '#f5d0fe', display: 'flex' }}>
                {`in “${truncate(circle.name, 32)}”`}
              </div>
            ) : (
              <div style={{ fontSize: 34, color: '#e9d5ff', display: 'flex' }}>Keep each other honest.</div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 18 }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 32,
                  display: 'flex',
                  background: i < filled ? 'linear-gradient(135deg, #c084fc, #f472b6)' : 'rgba(255,255,255,0.06)',
                  border: i < filled ? '0px solid transparent' : '4px dashed rgba(255,255,255,0.35)',
                }}
              />
            ))}
          </div>
          {reward ? (
            <div
              style={{
                display: 'flex',
                fontSize: 28,
                padding: '14px 24px',
                borderRadius: 999,
                background: 'rgba(255,255,255,0.12)',
                color: '#fdf4ff',
              }}
            >
              {reward}
            </div>
          ) : null}
        </div>
      </div>
    ),
    { ...OG_SIZE }
  );
  response.headers.set('Cache-Control', 'public, max-age=600, s-maxage=3600, stale-while-revalidate=86400');
  return response;
}
