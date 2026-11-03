import { fcmProvider, googleServiceAccountAccessToken, resendProvider, resendHostEmail, resendWebhook, webPushProvider } from '@inov8r/engage-adapters';
import type { EngageConfig } from '@inov8r/engage-server';
import type { Tenant } from '@inov8r/engage-protocol';
import type { FitCircleEngageHost } from './host';

/** Explicit channels and per-deployment keys; never infer an app from an inbound request. */
export function configureFitCircleProviders(
  tenant: Tenant,
  getHost: () => FitCircleEngageHost,
  env: Record<string,string|undefined> = process.env,
) {
  if (tenant.app_id !== 'fitcircle') throw new Error('Invalid FitCircle provider scope');
  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`Missing Engage configuration: ${name}`);
    return value;
  };
  const secret = (name: string) => {
    const value = required(name);
    if (Buffer.byteLength(value) < 32) throw new Error(`Engage configuration is too short: ${name}`);
    return value;
  };
  const channels = (env.ENGAGE_CHANNELS ?? '').split(',').map(v=>v.trim()).filter(Boolean);
  if (new Set(channels).size !== channels.length || channels.some(v=>!['push','email','web_push'].includes(v))) throw new Error('ENGAGE_CHANNELS must list distinct supported channels');
  const providers: EngageConfig['providers'] = {};
  const provider_webhooks: EngageConfig['provider_webhooks'] = {};
  let public_links: EngageConfig['public_links'];
  let web_push: EngageConfig['web_push'];
  let legacy_email: ReturnType<typeof resendHostEmail> | undefined;
  if (channels.includes('push')) {
    providers.push = fcmProvider({
      tenant,
      project_id: required('FCM_PROJECT_ID'),
      android_package: required('ENGAGE_ANDROID_PACKAGE'),
      ios_bundle_id: required('ENGAGE_IOS_BUNDLE_ID'),
      get_access_token: googleServiceAccountAccessToken({client_email:required('FCM_SERVICE_ACCOUNT_EMAIL'),private_key:required('FCM_PRIVATE_KEY').replace(/\\n/g,'\n')}),
      resolve_installation: payload=>getHost().resolveInstallation(payload),
    });
  }
  if (channels.includes('email')) {
    const origin = required('ENGAGE_PUBLIC_ORIGIN');
    const url = new URL(origin);
    if (url.origin !== origin || url.protocol !== 'https:' || url.username || url.password) throw new Error('ENGAGE_PUBLIC_ORIGIN must be an exact HTTPS origin');
    if (tenant.environment === 'production' && (!['fitcircle.ai','www.fitcircle.ai'].includes(url.hostname) || url.port)) throw new Error('Production links must use a FitCircle origin');
    public_links = {origin,secret:secret('ENGAGE_PUBLIC_LINK_SECRET')};
    if (public_links.secret === env.ENGAGE_ADMIN_SECRET) throw new Error('Public link and admin keys must be different');
    const from = required('ENGAGE_EMAIL_FROM');
    if (/[\r\n]/.test(from) || !/^[^<>\r\n]*<[^<>\s@]+@fitcircle\.ai>$/.test(from)) throw new Error('Engage email sender must use the FitCircle domain');
    providers.email = resendProvider({
      tenant,api_key:required('RESEND_API_KEY'),from,
      unsubscribe_url: payload=>getHost().publicConsent.unsubscribeUrl(payload),
      action_url: (_payload,action)=>{
        if (action.type === 'open_url') {
          const destination = new URL(action.url);
          return destination.protocol === 'https:' && ['fitcircle.ai','www.fitcircle.ai'].includes(destination.hostname) && !destination.username && !destination.password && !destination.port ? destination.href : null;
        }
        if (action.type === 'open_screen') {
          const paths: Record<string,string> = {dashboard:'/dashboard',food_log:'/food-log',exercise_log:'/exercise-log',streaks:'/streaks',circles:'/fitcircles',challenges:'/challenges',fitzy_chat:'/dashboard'};
          return paths[action.screen] ? new URL(paths[action.screen],origin).href : null;
        }
        return null;
      },
    });
    provider_webhooks.resend = resendWebhook({tenant,secrets:[required('ENGAGE_RESEND_WEBHOOK_SECRET'),...(env.ENGAGE_RESEND_WEBHOOK_PREVIOUS_SECRET ? [env.ENGAGE_RESEND_WEBHOOK_PREVIOUS_SECRET] : [])]});
    legacy_email = resendHostEmail({tenant,api_key:required('RESEND_API_KEY'),from,reply_to:'team@fitcircle.ai'});
  }
  if (channels.includes('web_push')) {
    web_push = {public_key:required('ENGAGE_WEB_PUSH_PUBLIC_KEY'),encryption_key:required('ENGAGE_WEB_PUSH_ENCRYPTION_KEY')};
    if (!/^[a-fA-F0-9]{64}$/.test(web_push.encryption_key)) throw new Error('Invalid Engage web-push encryption key');
    providers.web_push = webPushProvider({tenant,vapid:{subject:required('ENGAGE_WEB_PUSH_CONTACT'),public_key:web_push.public_key,private_key:required('ENGAGE_WEB_PUSH_PRIVATE_KEY')},resolve_installation:payload=>getHost().webPush.resolveInstallation(payload)});
  }
  return {providers,provider_webhooks,public_links,web_push,channels,legacy_email};
}
