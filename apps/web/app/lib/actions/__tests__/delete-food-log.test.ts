import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), deleteEntry: vi.fn() }));
vi.mock('../../supabase-server', () => ({ createServerSupabase: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock('../../services/food-log-service', () => ({ FoodLogService: { deleteEntry: mocks.deleteEntry } }));
vi.mock('../../utils/after-response', () => ({ runAfterResponse: vi.fn() }));
import { deleteFoodLogEntry } from '../delete-food-log';
const entry = '9f67c23e-825c-4a8b-a319-263170e6297c';
beforeEach(() => { vi.clearAllMocks(); });
it('derives ownership from the verified session and preserves server deletion failures', async () => {
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'verified-account' } }, error: null });
  mocks.deleteEntry.mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ success: false, error: new Error('private database details') });
  expect(await deleteFoodLogEntry(entry)).toEqual({ success: true });
  expect(mocks.deleteEntry).toHaveBeenCalledWith(entry, 'verified-account', expect.any(Object), { defer: expect.any(Function) });
  expect(await deleteFoodLogEntry(entry)).toEqual({ success: false });
});
it('rejects unauthenticated requests and malformed ids without deleting data', async () => {
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: new Error('expired') });
  expect(await deleteFoodLogEntry(entry)).toEqual({ success: false });
  expect(await deleteFoodLogEntry('../../other')).toEqual({ success: false });
  expect(mocks.deleteEntry).not.toHaveBeenCalled();
  expect(mocks.getUser).toHaveBeenCalledTimes(1);
});
