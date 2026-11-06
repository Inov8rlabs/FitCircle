'use client';

import { HeartPulse, Mail, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { ToggleRow } from '@/components/profile/settings-shell';
import { ListGroup } from '@/components/ui/ios';
import { consentClient, type ConsentSnapshot, type ConsentType } from '@/lib/api/consent-client';

import { ConsentDialog, type ConsentKind } from './ConsentDialog';

/**
 * Settings > Privacy: the server-side consent records (docs/PRIVACY_COMPLIANCE_SPEC.md §3).
 * Same records as the apps (GET/POST /api/consents). Turning health data or AI on shows the
 * full consent text first; turning anything off records a withdrawal.
 */
export function ConsentSettings() {
  const [snapshot, setSnapshot] = useState<ConsentSnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [asking, setAsking] = useState<ConsentKind | null>(null);

  useEffect(() => {
    consentClient
      .get({ fresh: true })
      .then(setSnapshot)
      .catch(() => setFailed(true));
  }, []);

  const record = async (type: ConsentType, granted: boolean): Promise<string | null> => {
    try {
      setSnapshot(await consentClient.set(type, granted));
      toast.success(granted ? 'Saved' : 'Turned off');
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'We could not save your choice. Please try again.';
    }
  };

  const onToggle = (type: ConsentType) => async (checked: boolean) => {
    if (checked && (type === 'ai_processing' || type === 'health_data')) {
      setAsking(type);
      return;
    }
    const err = await record(type, checked);
    if (err) toast.error(err);
  };

  const on = (t: ConsentType) => snapshot?.[t]?.granted === true;

  return (
    <>
      <ListGroup
        title="Consents"
        footer={
          failed
            ? 'We could not load your choices. Refresh to try again.'
            : 'Withdrawing health-data consent stops new health processing; you can also delete your data or account below.'
        }
      >
        <ToggleRow
          id="consent-health"
          icon={HeartPulse}
          tone="green"
          title="Health data"
          description="Process the weight, measurements, meals, water, activity and mood you log or connect"
          checked={on('health_data')}
          disabled={!snapshot}
          onCheckedChange={(c) => void onToggle('health_data')(c)}
        />
        <ToggleRow
          id="consent-ai"
          icon={Sparkles}
          tone="purple"
          title="AI features"
          description="Send photos, descriptions, chats and relevant logs to our AI providers (Anthropic, Google)"
          checked={on('ai_processing')}
          disabled={!snapshot}
          onCheckedChange={(c) => void onToggle('ai_processing')(c)}
        />
        <ToggleRow
          id="consent-marketing"
          icon={Mail}
          tone="cyan"
          title="Tips and updates by email"
          description="Occasional product news and challenges. Unsubscribe from any email."
          checked={snapshot?.marketing_email ? on('marketing_email') : snapshot?.effective?.marketingEmail === true}
          disabled={!snapshot}
          onCheckedChange={(c) => void onToggle('marketing_email')(c)}
        />
      </ListGroup>
      {asking && (
        <ConsentDialog
          kind={asking}
          open
          onDecide={async (granted) => {
            if (!granted) {
              setAsking(null);
              return null;
            }
            const err = await record(asking, true);
            if (!err) setAsking(null);
            return err;
          }}
        />
      )}
    </>
  );
}
