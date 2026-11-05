/**
 * Shipped Android uploads beverage photos with the multipart part labelled `image/*`
 * (BeverageLogRepository: `photo.asRequestBody("image/*")`). The type check rejected
 * it and the app swallowed the error, so those photos were never saved.
 */
import { File as NodeFile } from 'node:buffer';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { createReplaySupabase } from '../../../../__tests__/helpers/replay-supabase';
import { BeverageLogImageService } from '../beverage-log-image-service';

const USER = '11111111-1111-4111-8111-111111111111';
const LOG = '77777777-7777-4777-8777-777777777777';

async function jpeg(): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width: 8, height: 8, channels: 3, background: '#336699' } }).jpeg().toBuffer()
  );
}

// jsdom's File has no arrayBuffer(); the route handler gets a real (undici/Node) File.
const file = (parts: Uint8Array[], name: string, opts: { type: string }) =>
  new NodeFile(parts, name, opts) as unknown as File;

function setup() {
  return createReplaySupabase({ beverage_logs: [{ id: LOG, user_id: USER, category: 'coffee' }] });
}

describe('BeverageLogImageService.uploadImage content type', () => {
  it('accepts a generic image/* label when the bytes are a JPEG (was: rejected)', async () => {
    const fake = setup();
    const upload = file([await jpeg()], 'photo.jpg', { type: 'image/*' });
    const result = await BeverageLogImageService.uploadImage(LOG, USER, upload, 0, fake.client);
    expect(result.success, String(result.error)).toBe(true);
    expect(fake.rows('beverage_log_images')).toHaveLength(1);
  });

  it('still accepts a precise type, and still rejects a non-image behind a generic label', async () => {
    const fake = setup();
    const ok = await BeverageLogImageService.uploadImage(
      LOG, USER, file([await jpeg()], 'a.jpg', { type: 'image/jpeg' }), 0, fake.client
    );
    expect(ok.success).toBe(true);

    const bad = await BeverageLogImageService.uploadImage(
      LOG, USER, file([new TextEncoder().encode('%PDF-1.7 not an image')], 'a.pdf', { type: 'image/*' }), 1, fake.client
    );
    expect(bad.success).toBe(false);
    expect(bad.error?.message).toMatch(/Invalid file type/);

    const gif = await BeverageLogImageService.uploadImage(
      LOG, USER, file([new TextEncoder().encode('GIF89a')], 'a.gif', { type: 'image/gif' }), 1, fake.client
    );
    expect(gif.success).toBe(false);
  });
});
