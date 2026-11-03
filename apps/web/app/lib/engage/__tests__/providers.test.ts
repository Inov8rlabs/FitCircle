import {createECDH,generateKeyPairSync} from 'node:crypto';
import {describe,expect,it,vi,afterEach} from 'vitest';
import {configureFitCircleProviders} from '../providers';
const tenant={app_id:'fitcircle',environment:'staging' as const};
const host=()=>{throw new Error('Host must resolve lazily');};
const email=()=>({ENGAGE_CHANNELS:'email',ENGAGE_PUBLIC_ORIGIN:'https://staging.fitcircle.ai',ENGAGE_PUBLIC_LINK_SECRET:'l'.repeat(40),ENGAGE_ADMIN_SECRET:'a'.repeat(40),ENGAGE_EMAIL_FROM:'FitCircle <team@fitcircle.ai>',RESEND_API_KEY:'synthetic-test-key',ENGAGE_RESEND_WEBHOOK_SECRET:`whsec_${Buffer.alloc(32,10).toString('base64')}`});
afterEach(()=>vi.unstubAllGlobals());
describe('FitCircle provider readiness configuration',()=>{
  it('does not infer channels or use the network while constructing a fixed deployment',()=>{
    const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
    expect(configureFitCircleProviders(tenant,host,{}).channels).toEqual([]);
    const c=configureFitCircleProviders(tenant,host,email());
    expect(c.providers.email?.tenant).toEqual(tenant);expect(c.provider_webhooks.resend?.tenant).toEqual(tenant);expect(c.legacy_email?.tenant).toEqual(tenant);
    expect(fetcher).not.toHaveBeenCalled();
    expect(()=>configureFitCircleProviders({...tenant,app_id:'other'},host,email())).toThrow('scope');
  });
  it('fails closed on incomplete, repeated, unknown, cross-domain and shared-key configurations',()=>{
    for (const patch of [{ENGAGE_CHANNELS:'email,email'},{ENGAGE_CHANNELS:'sms'},{RESEND_API_KEY:''},{ENGAGE_PUBLIC_ORIGIN:'http://fitcircle.ai'},{ENGAGE_PUBLIC_ORIGIN:'https://fitcircle.ai/path'},{ENGAGE_PUBLIC_LINK_SECRET:'short'},{ENGAGE_PUBLIC_LINK_SECRET:'a'.repeat(40)},{ENGAGE_EMAIL_FROM:'FitCircle <team@other.test>'},{ENGAGE_RESEND_WEBHOOK_SECRET:'invalid'}]) expect(()=>configureFitCircleProviders(tenant,host,{...email(),...patch})).toThrow();
    for (const origin of ['https://other.test','https://fitcircle.ai:8443']) expect(()=>configureFitCircleProviders({...tenant,environment:'production'},host,{...email(),ENGAGE_PUBLIC_ORIGIN:origin})).toThrow('FitCircle origin');
  });
  it('validates native project identifiers, RSA credentials and browser keys without contacting providers',()=>{
    const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
    const push={ENGAGE_CHANNELS:'push',FCM_PROJECT_ID:'fitcircle-test',FCM_SERVICE_ACCOUNT_EMAIL:'test@fitcircle-test.iam.gserviceaccount.com',FCM_PRIVATE_KEY:privateKey.export({type:'pkcs8',format:'pem'}).toString(),ENGAGE_ANDROID_PACKAGE:'ai.fitcircle.app',ENGAGE_IOS_BUNDLE_ID:'ai.fitcircle.app'};
    expect(configureFitCircleProviders(tenant,host,push).providers.push?.tenant).toEqual(tenant);
    expect(()=>configureFitCircleProviders(tenant,host,{...push,FCM_PROJECT_ID:'https://foreign.test'})).toThrow();
    expect(()=>configureFitCircleProviders(tenant,host,{...push,ENGAGE_IOS_BUNDLE_ID:''})).toThrow();
    const ec=createECDH('prime256v1');ec.generateKeys();
    const web={ENGAGE_CHANNELS:'web_push',ENGAGE_WEB_PUSH_PUBLIC_KEY:ec.getPublicKey().toString('base64url'),ENGAGE_WEB_PUSH_PRIVATE_KEY:ec.getPrivateKey().toString('base64url'),ENGAGE_WEB_PUSH_ENCRYPTION_KEY:'ab'.repeat(32),ENGAGE_WEB_PUSH_CONTACT:'mailto:team@fitcircle.ai'};
    expect(configureFitCircleProviders(tenant,host,web).providers.web_push?.tenant).toEqual(tenant);
    expect(()=>configureFitCircleProviders(tenant,host,{...web,ENGAGE_WEB_PUSH_ENCRYPTION_KEY:'bad'})).toThrow();
  });
});
