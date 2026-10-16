import type { buildPreviewView } from '@/lib/campaigns/campaign-utils';
import type { AdminCampaign, ArtSlot, CampaignInput } from '@/lib/campaigns/types';

/** What every editor section receives from CampaignEditor. */
export interface EditorApi {
  draft: CampaignInput;
  /** Last server copy (null for a new, unsaved campaign). */
  campaign: AdminCampaign | null;
  dirty: boolean;
  update: (patch: Partial<CampaignInput>) => void;
  set: (fn: (d: CampaignInput) => CampaignInput) => void;
  /** Saves pending changes (or creates the campaign) and returns the server copy; null on failure. */
  ensureSaved: () => Promise<AdminCampaign | null>;
  /** Adopt a server copy (e.g. after an art upload) without touching unsaved draft fields. */
  applyServer: (c: AdminCampaign) => void;
  refreshServer: () => Promise<AdminCampaign | null>;
  previewDate: string;
  setPreviewDate: (d: string) => void;
  todayOpened: boolean;
  setTodayOpened: (v: boolean) => void;
  previewView: ReturnType<typeof buildPreviewView>;
  /** Art for mocks: uploaded URL or a generated SVG data URL. */
  artFor: (slot: ArtSlot) => { url: string; uploaded: boolean };
}
