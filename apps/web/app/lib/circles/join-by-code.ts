/**
 * Web join by invite code through `POST /api/mobile/circles/join` (cookie auth),
 * the same server path the apps and the /join landing use: member row, count,
 * chat "joined" post, daily goals and referral attribution. Never insert into
 * `fitcircle_members` from the browser.
 */
export async function joinCircleByCode(inviteCode: string, ref?: string | null): Promise<void> {
  const response = await fetch('/api/mobile/circles/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ inviteCode: inviteCode.toUpperCase().replace(/[^A-Z0-9]/g, ''), ...(ref ? { ref } : {}) }),
  });
  if (response.ok) return;
  const body = (await response.json().catch(() => null)) as { message?: string } | null;
  if (response.status === 409) throw new Error('You are already a member of this FitCircle');
  throw new Error(body?.message || 'Failed to join FitCircle');
}
