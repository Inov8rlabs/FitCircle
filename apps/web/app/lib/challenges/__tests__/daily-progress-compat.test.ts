import { describe, expect, it } from 'vitest';

import {
  absoluteToFraction,
  declaresAbsoluteProgress,
  fractionToAbsolute,
  isIosRequest,
  usesFractionProgress,
} from '../daily-progress-compat';

const req = (h: Record<string, string>) => ({ headers: new Headers(h) });

describe('daily-challenge progress units', () => {
  it('recognises iOS by X-App-Platform, else by an iOS URLSession User-Agent', () => {
    expect(isIosRequest(req({ 'x-app-platform': 'ios' }))).toBe(true);
    expect(isIosRequest(req({ 'x-app-platform': 'iOS ' }))).toBe(true);
    expect(isIosRequest(req({ 'user-agent': 'FitCircle/61 CFNetwork/1568 Darwin/24.0.0' }))).toBe(true);
    expect(isIosRequest(req({ 'x-app-platform': 'android', 'user-agent': 'x CFNetwork/1 Darwin/1' }))).toBe(false);
    expect(isIosRequest(req({ 'user-agent': 'okhttp/4.12.0' }))).toBe(false);
    expect(isIosRequest(req({}))).toBe(false);
  });

  it('only iOS without challenge_progress_abs is a fraction client', () => {
    expect(declaresAbsoluteProgress('icon_keys, challenge_progress_abs')).toBe(true);
    expect(declaresAbsoluteProgress('icon_keys')).toBe(false);
    expect(usesFractionProgress(req({ 'x-app-platform': 'ios', 'x-client-features': 'icon_keys' }))).toBe(true);
    expect(usesFractionProgress(req({ 'x-app-platform': 'ios', 'x-client-features': 'challenge_progress_abs' }))).toBe(false);
    expect(usesFractionProgress(req({ 'x-app-platform': 'android' }))).toBe(false);
  });

  it('converts both ways; a value above 1 is never a fraction; no goal leaves values alone', () => {
    expect(fractionToAbsolute(1, 10000)).toBe(10000);
    expect(fractionToAbsolute(0.333, 30)).toBe(9.99);
    expect(fractionToAbsolute(3, 30)).toBe(3);
    expect(fractionToAbsolute(0.5, 0)).toBe(0.5);
    expect(absoluteToFraction(2500, 10000)).toBe(0.25);
    expect(absoluteToFraction(12000, 10000)).toBe(1.2);
    expect(absoluteToFraction(5, 0)).toBe(5);
  });
});
