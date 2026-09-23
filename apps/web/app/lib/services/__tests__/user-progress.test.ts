import { describe, expect, it, vi } from 'vitest';

vi.mock('../../supabase-admin', () => ({ createAdminSupabase: () => ({}) }));

import { UserService } from '../user-service';

describe('UserService.deriveWeightProgress', () => {
  it('leaves everything unknown when the member has no goal and no weigh-in', () => {
    expect(UserService.deriveWeightProgress({ startKg: null, currentKg: null, targetKg: null })).toEqual({
      starting_weight: null,
      current_weight: null,
      target_weight: null,
      progress_percentage: 0,
      weight_lost: 0,
      weight_to_go: 0,
    });
  });

  it('never turns a missing start/target into 0 (the "-91.7 lost, 91.7 to go" bug)', () => {
    const out = UserService.deriveWeightProgress({ startKg: 0, currentKg: 91.7, targetKg: 0 });
    expect(out.starting_weight).toBeNull();
    expect(out.target_weight).toBeNull();
    expect(out.current_weight).toBe(91.7);
    expect(out.weight_lost).toBe(0);
    expect(out.weight_to_go).toBe(0);
    expect(out.progress_percentage).toBe(0);
  });

  it('computes a weight-loss goal: lost, to go and percent', () => {
    const out = UserService.deriveWeightProgress({ startKg: 94, currentKg: 89, targetKg: 84 });
    expect(out).toMatchObject({ weight_lost: 5, weight_to_go: 5, progress_percentage: 50 });
  });

  it('reports gained weight as a negative loss and floors to-go at 0 once past the target', () => {
    expect(UserService.deriveWeightProgress({ startKg: 90, currentKg: 92, targetKg: 85 }).weight_lost).toBe(-2);
    expect(UserService.deriveWeightProgress({ startKg: 90, currentKg: 84, targetKg: 85 }).weight_to_go).toBe(0);
  });

  it('measures to-go in the goal direction for a gain goal', () => {
    const out = UserService.deriveWeightProgress({ startKg: 60, currentKg: 62, targetKg: 66 });
    expect(out.weight_to_go).toBe(4);
    expect(out.weight_lost).toBe(-2);
  });

  it('accepts numeric strings from the database and rounds to one decimal', () => {
    const out = UserService.deriveWeightProgress({ startKg: '91.66' as unknown as number, currentKg: 90.04, targetKg: '80' as unknown as number });
    expect(out.starting_weight).toBe(91.66);
    expect(out.weight_lost).toBe(1.6);
    expect(out.weight_to_go).toBe(10);
  });
});
