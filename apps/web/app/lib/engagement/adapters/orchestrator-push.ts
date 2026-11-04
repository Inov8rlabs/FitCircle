/**
 * PushSender over NotificationOrchestrator.send — the only push path
 * (category toggles, the daily cap, quiet hours, dedupe and burst control all
 * apply). Lifecycle pushes never bypass it.
 */
import { NotificationOrchestrator } from '../../services/notification-orchestrator';
import type { RenderedPush } from '../render/push';

import type { PushResult, PushSender } from './types';

export class OrchestratorPushSender implements PushSender {
  async send(userId: string, push: RenderedPush): Promise<PushResult> {
    try {
      const res = await NotificationOrchestrator.send(userId, push.type, { ...push.data });
      return res.sent ? { sent: true } : { sent: false, reason: res.reason ?? 'not_sent' };
    } catch (err: any) {
      console.error('[engagement] push failed:', push.type, err?.message);
      return { sent: false, reason: 'error' };
    }
  }
}
