import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({owned:true,result:null as any}));
const token={id:'token-row',user_id:'account',token:'synthetic-token',platform:'ios'};
vi.mock('../server',()=>({nativeBridgeActive:async()=>true}));
vi.mock('jsonwebtoken',()=>({sign:()=> 'synthetic-jwt'}));
vi.mock('../../supabase-admin',()=>({createAdminSupabase:()=>({from:()=>{
  const q:any={select:()=>q,update:()=>q,eq:()=>q,maybeSingle:async()=>({data:state.owned?{id:'token-row',token:'synthetic-token'}:null,error:null}),then:(resolve:any)=>Promise.resolve(resolve({data:[{id:'token-row',user_id:'account',token:'synthetic-token',platform:'ios'}],error:null}))};return q;
}})}));
vi.mock('../legacy-push',()=>({deliverLegacyPush:async(_user:any,_input:any,tokens:any[],send:any)=>{state.result=await send(tokens[0],new AbortController().signal);return state.result.status==='accepted'?1:0;}}));
beforeEach(()=>{
  vi.resetModules();state.owned=true;state.result=null;
  vi.stubEnv('ENGAGE_LEGACY_BRIDGE_ENABLED','true');vi.stubEnv('FCM_PROJECT_ID','fitcircle-test');vi.stubEnv('FCM_SERVICE_ACCOUNT_EMAIL','sender@example.test');vi.stubEnv('FCM_PRIVATE_KEY','synthetic');
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
async function send(response:()=>Response,auth?:()=>Response){
  const fetch=vi.fn(async(url:string)=>url.includes('oauth2.googleapis.com')?(auth?.() ?? Response.json({access_token:'synthetic-access-token',expires_in:3600})):response());vi.stubGlobal('fetch',fetch);
  const {PushService}=await import('../../services/push-service');
  const count=await PushService.sendPush(token.user_id,{title:'Hello',body:'Synthetic only',engage:{key:'event:one',category:'marketing'}});return {count,fetch};
}
it('records the actual provider message ID rather than the recipient token row',async()=>{
  const result=await send(()=>Response.json({name:'projects/fitcircle-test/messages/accepted'}));
  expect(result.count).toBe(1);expect(state.result).toEqual({status:'accepted',provider_id:'projects/fitcircle-test/messages/accepted'});
  expect(result.fetch).toHaveBeenCalledTimes(2);
});
it.each(['foreign-project','oversized','malformed'])('quarantines an uncertain %s acceptance without retrying',async(mode)=>{
  const result=await send(()=>mode==='oversized'?new Response('{}',{headers:{'content-length':'20000'}}):mode==='malformed'?new Response('not-json'):Response.json({name:'projects/another-app/messages/id'}));
  expect(result.count).toBe(0);expect(state.result.status).toBe('unknown');expect(result.fetch).toHaveBeenCalledTimes(2);
});
it('rechecks exact ownership after credential acquisition and never contacts FCM after reassignment',async()=>{
  const result=await send(()=>{throw new Error('Unexpected provider call');},()=>{state.owned=false;return Response.json({access_token:'synthetic-access-token',expires_in:3600});});
  expect(result.count).toBe(0);expect(state.result.status).toBe('failed_permanent');expect(result.fetch).toHaveBeenCalledTimes(1);
});
it('bounds credential responses before any provider handoff',async()=>{
  const result=await send(()=>{throw new Error('Unexpected provider call');},()=>new Response('{}',{headers:{'content-length':'20000'}}));
  expect(result.count).toBe(0);expect(state.result.status).toBe('retryable');expect(result.fetch).toHaveBeenCalledTimes(1);
});
