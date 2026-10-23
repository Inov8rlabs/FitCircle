import { describe, expect, it } from 'vitest';

import {
  ANDROID_PACKAGE,
  APP_STORE_ID,
  absoluteGetAppUrl,
  appStoreUrl,
  getAppHref,
  hasInvite,
  openAppUrl,
  openPath,
  parseGetAppParams,
  playStoreUrl,
  showsNativeSmartBanner,
  storeTargetFor,
} from '../index';

const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const CHROME_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1';
const INSTAGRAM_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0';
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';

describe('parseGetAppParams', () => {
  it('normalizes codes and keeps known UTM keys', () => {
    const p = parseGetAppParams(
      new URLSearchParams('ref= anki7qx &circle=fitabc123&utm_source=ig&utm_campaign=htl&placement=hero&evil=1')
    );
    expect(p).toEqual({
      ref: 'ANKI7QX',
      circle: 'FITABC123',
      placement: 'hero',
      utm: { utm_source: 'ig', utm_campaign: 'htl' },
    });
  });

  it('drops unsafe values', () => {
    const p = parseGetAppParams({ ref: '<script>', utm_source: 'a b&c', placement: 'x'.repeat(80) });
    expect(p.ref).toBeNull();
    expect(p.placement).toBeNull();
    expect(p.utm).toEqual({});
  });

  it('accepts a Next searchParams record with array values', () => {
    expect(parseGetAppParams({ ref: ['ANKI7QX', 'OTHER'] }).ref).toBe('ANKI7QX');
  });
});

describe('store URLs', () => {
  it('App Store URL is the bare listing without a provider token', () => {
    expect(appStoreUrl({ ref: 'ANKI7QX' })).toBe(`https://apps.apple.com/app/id${APP_STORE_ID}`);
  });

  it('App Store URL carries pt/ct when a provider token is configured', () => {
    const u = new URL(appStoreUrl({ ref: 'ANKI7QX', placement: 'hero' }, '123456'));
    expect(u.searchParams.get('pt')).toBe('123456');
    expect(u.searchParams.get('ct')).toBe('hero-ANKI7QX');
    expect(u.searchParams.get('ct')!.length).toBeLessThanOrEqual(40);
  });

  it('Play URL puts the invite and UTM in the install referrer', () => {
    const u = new URL(playStoreUrl({ ref: 'ANKI7QX', circle: 'FITABC123', utm: { utm_source: 'ig' } }));
    expect(u.searchParams.get('id')).toBe(ANDROID_PACKAGE);
    const referrer = new URLSearchParams(u.searchParams.get('referrer')!);
    expect(referrer.get('fc_ref')).toBe('ANKI7QX');
    expect(referrer.get('fc_circle')).toBe('FITABC123');
    expect(referrer.get('utm_source')).toBe('ig');
    expect(referrer.get('utm_medium')).toBe('invite');
  });

  it('defaults utm_medium to get_app without an invite', () => {
    const referrer = new URLSearchParams(new URL(playStoreUrl({})).searchParams.get('referrer')!);
    expect(referrer.get('utm_source')).toBe('web');
    expect(referrer.get('utm_medium')).toBe('get_app');
  });

  it('storeTargetFor routes by platform', () => {
    expect(storeTargetFor('ios', {}).store).toBe('app_store');
    expect(storeTargetFor('android', {}).store).toBe('play_store');
    expect(storeTargetFor('desktop', {})).toEqual({ store: 'none', url: null });
  });
});

describe('/get and /open links', () => {
  it('builds a relative /get link', () => {
    expect(getAppHref()).toBe('/get');
    expect(getAppHref({ placement: 'nav', ref: 'ANKI7QX', utm: { utm_source: 'x' } })).toBe(
      '/get?placement=nav&ref=ANKI7QX&utm_source=x'
    );
  });

  it('marks the QR link as utm_medium=qr', () => {
    expect(absoluteGetAppUrl({ placement: 'get_page' })).toBe(
      'https://www.fitcircle.ai/get?placement=get_page&utm_medium=qr'
    );
  });

  it('openPath mirrors /get params', () => {
    expect(openPath({ placement: 'banner' })).toBe('/open?placement=banner');
  });

  it('hasInvite', () => {
    expect(hasInvite({})).toBe(false);
    expect(hasInvite({ circle: 'FITABC123' })).toBe(true);
  });
});

describe('openAppUrl', () => {
  const fallback = 'https://play.google.com/store/apps/details?id=x';

  it('iOS uses the apex host so Safari hands it to the universal link', () => {
    expect(openAppUrl('ios', '/join/FITABC123?ref=A', fallback)).toBe('https://fitcircle.ai/join/FITABC123?ref=A');
  });

  it('Android uses the https App Link for claimed paths', () => {
    const u = openAppUrl('android', '/i/ANKI7QX', fallback)!;
    expect(u.startsWith('intent://www.fitcircle.ai/i/ANKI7QX#Intent;scheme=https;')).toBe(true);
    expect(u).toContain(`package=${ANDROID_PACKAGE}`);
    expect(u).toContain(`S.browser_fallback_url=${encodeURIComponent(fallback)}`);
  });

  it('Android launches the app for paths it does not claim', () => {
    const u = openAppUrl('android', '/open?placement=banner', fallback)!;
    expect(u.startsWith('intent:#Intent;action=android.intent.action.MAIN;')).toBe(true);
    expect(u).toContain('category=android.intent.category.LAUNCHER');
  });

  it('desktop has no open link', () => {
    expect(openAppUrl('desktop', '/open', fallback)).toBeNull();
  });
});

describe('showsNativeSmartBanner', () => {
  it('is true only for Safari on iOS', () => {
    expect(showsNativeSmartBanner(SAFARI_IPHONE)).toBe(true);
    expect(showsNativeSmartBanner(CHROME_IPHONE)).toBe(false);
    expect(showsNativeSmartBanner(INSTAGRAM_IPHONE)).toBe(false);
    expect(showsNativeSmartBanner(ANDROID_CHROME)).toBe(false);
    expect(showsNativeSmartBanner(null)).toBe(false);
  });
});
