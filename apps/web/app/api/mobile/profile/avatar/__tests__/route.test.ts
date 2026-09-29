import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /api/mobile/profile/avatar is the path the iOS app uploads to. It delegates
 * to the real upload/avatar handler (not mocked here).
 *
 * The suite runs under jsdom, whose FormData / File / Blob are not the ones the
 * Node runtime (and `Request.formData()`) uses in production, so the runtime's
 * own classes are put back for these tests.
 */
beforeAll(async () => {
  const probe = new Response('a=b', { headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  const runtimeFormData = (await probe.formData()).constructor;
  vi.stubGlobal('FormData', runtimeFormData);
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('File', NodeFile);
});

const state = {
  authed: true,
  uploads: [] as Array<{ bucket: string; path: string; bytes: number; contentType: string }>,
  profileUpdates: [] as Array<Record<string, any>>,
};

vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: async () => {
    if (!state.authed) throw new Error('Unauthorized');
    return { id: 'u1', email: 'a@b.com' };
  },
}));
vi.mock('@/lib/middleware/mobile-auto-refresh', () => ({
  addAutoRefreshHeaders: async (_req: unknown, res: unknown) => res,
}));
vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: () => ({}) }));
vi.mock('@/lib/services/mobile-api-service', () => ({
  MobileAPIService: {
    uploadImage: async (bucket: string, path: string, file: Buffer, contentType: string) => {
      state.uploads.push({ bucket, path, bytes: file.length, contentType });
      return `https://x.supabase.co/storage/v1/object/public/${bucket}/${path}`;
    },
    updateUserProfile: async (_userId: string, updates: Record<string, any>) => {
      state.profileUpdates.push(updates);
      return {};
    },
    deleteImage: async () => undefined,
  },
}));

import { POST as uploadRoutePost } from '../../../upload/avatar/route';
import { POST } from '../route';

/** The multipart body exactly as APIClient.swift `uploadAvatar` builds it. */
function multipart(field: string, bytes: Uint8Array, contentType = 'image/jpeg', filename = 'avatar.jpg') {
  const boundary = 'B3F1C2D4-0000-4000-8000-1234567890AB';
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;
  const body = Buffer.concat([Buffer.from(head, 'utf8'), Buffer.from(bytes), Buffer.from(tail, 'utf8')]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);

function upload(
  handler: (request: any) => Promise<Response>,
  path: string,
  field: string,
  bytes: Uint8Array = jpeg,
  contentType = 'image/jpeg'
) {
  const form = multipart(field, bytes, contentType);
  return handler(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      body: form.body,
      headers: { 'content-type': form.contentType, authorization: 'Bearer t' },
    })
  );
}

beforeEach(() => {
  state.authed = true;
  state.uploads = [];
  state.profileUpdates = [];
});

describe('POST /api/mobile/profile/avatar (iOS alias)', () => {
  it('accepts the multipart field `avatar` and answers with data.avatar_url', async () => {
    const res = await upload(POST, '/api/mobile/profile/avatar', 'avatar');
    expect(res.status).toBe(200);

    const body = await res.json();
    // iOS decodes APIResponse<AvatarUploadResponse>: success + data.avatar_url.
    expect(body.success).toBe(true);
    expect(body.error).toBeNull();
    expect(typeof body.data.avatar_url).toBe('string');
    expect(body.data.avatar_url).toMatch(/^https:\/\/x\.supabase\.co\/storage\/v1\/object\/public\/avatars\/avatars\/u1_\d+\.jpg$/);
    // The keys of the original route are kept too.
    expect(body.url).toBe(body.data.avatar_url);
    expect(body.message).toBe('Avatar uploaded successfully');

    expect(state.uploads).toHaveLength(1);
    expect(state.uploads[0]).toMatchObject({ bucket: 'avatars', bytes: jpeg.length, contentType: 'image/jpeg' });
    expect(state.profileUpdates).toEqual([{ avatar_url: body.data.avatar_url }]);
  });

  it('also accepts the field `file`', async () => {
    const res = await upload(POST, '/api/mobile/profile/avatar', 'file');
    expect(res.status).toBe(200);
    expect(state.uploads).toHaveLength(1);
  });

  it('applies the same checks as the upload route: no file', async () => {
    const res = await upload(POST, '/api/mobile/profile/avatar', 'picture');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.data).toBeNull();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('Please provide a file to upload');
    expect(state.uploads).toHaveLength(0);
  });

  it('applies the same checks as the upload route: file type', async () => {
    const res = await upload(POST, '/api/mobile/profile/avatar', 'avatar', jpeg, 'application/pdf');
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe('Only JPEG, PNG, WEBP, and HEIC images are allowed');
    expect(state.uploads).toHaveLength(0);
  });

  it('applies the same checks as the upload route: size', async () => {
    const res = await upload(POST, '/api/mobile/profile/avatar', 'avatar', new Uint8Array(5 * 1024 * 1024 + 1));
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe('Avatar image must be less than 5MB');
    expect(state.uploads).toHaveLength(0);
  });

  it('requires authentication', async () => {
    state.authed = false;
    const res = await upload(POST, '/api/mobile/profile/avatar', 'avatar');
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(state.uploads).toHaveLength(0);
  });
});

describe('POST /api/mobile/upload/avatar (Android, unchanged)', () => {
  it('still takes the field `file` and answers { success, url, message }', async () => {
    const res = await upload(uploadRoutePost, '/api/mobile/upload/avatar', 'file');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['message', 'success', 'url']);
    expect(body.success).toBe(true);
    expect(body.url).toMatch(/\/avatars\/avatars\/u1_\d+\.jpg$/);
  });

  it('still does not take the field `avatar`', async () => {
    const res = await upload(uploadRoutePost, '/api/mobile/upload/avatar', 'avatar');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'No file provided', message: 'Please provide a file to upload' });
  });
});
