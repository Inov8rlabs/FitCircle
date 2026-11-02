/**
 * Web client for the user's own profile name (PUT /api/mobile/profile, the
 * same endpoint and rule the apps use — lib/validation/display-name.ts).
 */
import { useAuthStore } from '@/stores/auth-store';

export class ProfileApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    /** Field → message, e.g. { displayName: 'Names can be up to 40 characters' }. */
    readonly details: Record<string, string> = {}
  ) {
    super(message);
    this.name = 'ProfileApiError';
  }
}

export interface ProfileNameUpdate {
  displayName?: string;
  username?: string;
}

/** Save name/username; resolves to the stored values (normalized by the server). */
export async function updateProfileName(
  update: ProfileNameUpdate
): Promise<{ displayName: string; username: string }> {
  const token = useAuthStore.getState().token;
  const res = await fetch('/api/mobile/profile', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: 'include',
    body: JSON.stringify(update),
  });
  const json = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    data?: { user?: { display_name?: string; username?: string } } | null;
    error?: { code?: string; message?: string; details?: Record<string, string> } | null;
  };
  if (!res.ok || json.success === false || !json.data?.user) {
    throw new ProfileApiError(
      json.error?.message || `Couldn't save (${res.status})`,
      res.status,
      json.error?.code ?? null,
      json.error?.details ?? {}
    );
  }
  return {
    displayName: json.data.user.display_name ?? update.displayName ?? '',
    username: json.data.user.username ?? update.username ?? '',
  };
}
