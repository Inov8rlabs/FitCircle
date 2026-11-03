import type { HostNotificationInput } from '@inov8r/engage-server';
import { getFitCircleLegacyEmail } from './server';
import {createHash} from 'node:crypto';

export interface AccountEmail {
  to: string;
  subject: string;
  html: string;
  text?: string;
}
/** Registered accounts only. Guest addresses never become account identities by an email lookup. */
export async function deliverLegacyEmail(
  userId: string,
  input: Omit<HostNotificationInput,'channel'>,
  email: AccountEmail,
): Promise<boolean> {
  if (!input.key) throw new Error('Legacy email requires a stable domain occurrence key');
  const {host,transport} = getFitCircleLegacyEmail();
  await host.syncSubject(userId);
  const recipient=email.to.trim().toLowerCase();
  const unsubscribe=input.category==='marketing' ? await host.publicConsent.unsubscribeUrl({user_id:userId}) : undefined;
  const result=await host.hostNotifications.sendTargets({tenant:host.tenant,user_id:userId},{...input,channel:'email'},[{
    id:'verified-account-email',platform:'not_applicable',email:recipient,
    send:async (signal,context)=>{
      // Recheck the host's verified address immediately before initiating the network call.
      const current=await host.db.query("select email from auth.users where id=$1 and email_confirmed_at is not null",[userId]);
      if (current.rows[0]?.email?.trim().toLowerCase()!==recipient) return {status:'failed_permanent',reason:'email_target_changed'};
      if(!await host.authorize({user_id:userId,channel:'email',platform:'not_applicable',category:input.category,lifecycle_category:input.lifecycle_category,target_hash:createHash('sha256').update(recipient).digest('hex')}))return {status:'failed_permanent',reason:'host_recipient_denied'};
      if (signal.aborted) return {status:'failed_permanent',reason:'email_cancelled_before_handoff'};
      return transport.send({...host.tenant,...context,email:recipient,subject:email.subject,
        html:email.html+(unsubscribe ? `<p><a href="${unsubscribe.replaceAll('&','&amp;').replaceAll('"','&quot;')}">Manage email preferences</a></p>`:''),
        text:email.text ? email.text+(unsubscribe ? `\n\nEmail preferences: ${unsubscribe}`:'') : undefined,
        unsubscribe_url:unsubscribe,
      },signal);
    },
  }]);
  return result.accepted>0 || (result.result.status==='duplicate' && result.result.previous==='accepted');
}
