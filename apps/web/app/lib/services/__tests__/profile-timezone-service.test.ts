import { describe, expect, it } from 'vitest';

import { ProfileTimezoneService } from '../profile-timezone-service';

describe('ProfileTimezoneService.pendingUpdate', () => {
  it('stores a valid device timezone that differs from the profile', () => {
    expect(ProfileTimezoneService.pendingUpdate('UTC', 'America/Los_Angeles')).toBe('America/Los_Angeles');
    expect(ProfileTimezoneService.pendingUpdate(null, 'Asia/Kolkata')).toBe('Asia/Kolkata');
  });
  it('does nothing when unchanged, missing or invalid', () => {
    expect(ProfileTimezoneService.pendingUpdate('Europe/London', 'Europe/London')).toBeNull();
    expect(ProfileTimezoneService.pendingUpdate('UTC', null)).toBeNull();
    expect(ProfileTimezoneService.pendingUpdate('UTC', 'Not/AZone')).toBeNull();
    expect(ProfileTimezoneService.pendingUpdate('UTC', '')).toBeNull();
  });
});
