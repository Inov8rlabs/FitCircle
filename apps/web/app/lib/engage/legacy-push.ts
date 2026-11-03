import type { HostNotificationInput, ProviderResult } from '@inov8r/engage-server';
import type { PushToken } from '../services/push-service';
import { getFitCircleEngage } from './server';
import {createHash} from 'node:crypto';

/** Every legacy push funnels through this gate when cutover is enabled. */
export async function deliverLegacyPush(
  userId: string,
  input: Omit<HostNotificationInput, 'channel'> | undefined,
  tokens: PushToken[],
  send: (token: PushToken, signal: AbortSignal) => Promise<ProviderResult>,
): Promise<number> {
  if (!input?.key) throw new Error('Legacy push requires a stable domain occurrence key');
  const host = getFitCircleEngage();
  if (!host) throw new Error('Legacy bridge requires Engage to be configured');
  await host.syncSubject(userId);
  const result = await host.hostNotifications.sendTargets(
    {tenant:host.tenant,user_id:userId},
    {...input,channel:'push'},
    tokens.filter((token) => token.platform === 'ios' || token.platform === 'android').map((token) => ({
      id: token.id,
      platform: token.platform as 'ios' | 'android',
      send: async (signal: AbortSignal) => {
        if(!await host.authorize({user_id:userId,channel:'push',platform:token.platform as 'ios'|'android',category:input.category,lifecycle_category:input.lifecycle_category,target_hash:createHash('sha256').update(token.token).digest('hex')},token.id))return {status:'failed_permanent' as const,reason:'host_recipient_denied'};
        return send(token,signal);
      },
    })),
  );
  return result.accepted;
}
