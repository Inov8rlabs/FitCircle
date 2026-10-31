'use client';

import { MessageList } from '../../engage/messages/MessageList';
import type { EditorApi } from '../editor-api';
import { Callout, Section } from '../fields';

/** Engage messages (cards, in-app, push, email) attached to this campaign (ENGAGE_SPEC §12). */
export function EngageMessagesSection({ api }: { api: EditorApi }) {
  return (
    <Section id="engage" index={6} title="Engage messages" description="Content cards, in-app messages, pushes and emails that belong to this campaign.">
      {api.campaign ? (
        <MessageList embedded campaignId={api.campaign.id} />
      ) : (
        <Callout tone="info">Save the campaign to attach messages to it.</Callout>
      )}
    </Section>
  );
}
