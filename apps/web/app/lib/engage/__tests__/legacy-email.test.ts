import {randomUUID} from 'node:crypto';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({configured:null as any}));
vi.mock('../server',()=>({getFitCircleLegacyEmail:()=>{if(!state.configured) throw new Error('not configured');return state.configured;}}));
import {deliverLegacyEmail} from '../legacy-email';
const tenant={app_id:'fitcircle',environment:'test' as const};
const user=randomUUID(),input={key:'reward:stable',category:'marketing' as const};
const email={to:'Verified@Example.test',subject:'Hello',html:'<p>Hello</p>',text:'Hello'};
beforeEach(()=>{
  const host={tenant,authorize:vi.fn(async()=>true),syncSubject:vi.fn(async()=>{}),publicConsent:{unsubscribeUrl:vi.fn(()=>'https://app.test/unsubscribe?t=token')},db:{query:vi.fn(async()=>({rows:[{email:email.to}]}))},hostNotifications:{sendTargets:vi.fn(async(_identity:any,_input:any,targets:any[])=>{const outcome=await targets[0].send(new AbortController().signal,{notification_id:randomUUID(),handoff_id:randomUUID()});return {accepted:outcome.status==='accepted'?1:0,result:outcome};})}};
  state.configured={host,transport:{send:vi.fn(async()=>({status:'accepted',provider_id:'provider'}))}};
});
afterEach(()=>{state.configured=null;});
describe('registered-account email bridge',()=>{
  it('carries the stable occurrence and fixed scope through the shared gate with signed unsubscribe',async()=>{
    expect(await deliverLegacyEmail(user,input,email)).toBe(true);
    const {host,transport}=state.configured;
    expect(host.syncSubject).toHaveBeenCalledWith(user);
    expect(host.hostNotifications.sendTargets).toHaveBeenCalledWith({tenant,user_id:user},{...input,channel:'email'},[expect.objectContaining({email:'verified@example.test',platform:'not_applicable'})]);
    expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({...tenant,email:'verified@example.test',unsubscribe_url:'https://app.test/unsubscribe?t=token'}),expect.any(AbortSignal));
    expect(transport.send.mock.calls[0][0].html).toContain('Manage email preferences');
  });
  it('stops on lost verification, deletion/configuration failure and policy suppression without raw transport fallback',async()=>{
    state.configured.host.db.query.mockResolvedValue({rows:[]});
    expect(await deliverLegacyEmail(user,input,email)).toBe(false);
    expect(state.configured.transport.send).not.toHaveBeenCalled();
    state.configured.host.syncSubject.mockRejectedValue(new Error('deleted'));
    await expect(deliverLegacyEmail(user,input,email)).rejects.toThrow('deleted');
    expect(state.configured.transport.send).not.toHaveBeenCalled();
    state.configured=null;await expect(deliverLegacyEmail(user,input,email)).rejects.toThrow('not configured');
  });
  it('reports an accepted duplicate as complete without another physical send, but preserves an unknown outcome',async()=>{
    state.configured.host.hostNotifications.sendTargets.mockResolvedValue({accepted:0,result:{status:'duplicate',previous:'accepted'}});
    expect(await deliverLegacyEmail(user,input,email)).toBe(true);
    state.configured.host.hostNotifications.sendTargets.mockResolvedValue({accepted:0,result:{status:'duplicate',previous:'unknown'}});
    expect(await deliverLegacyEmail(user,input,email)).toBe(false);
    expect(state.configured.transport.send).not.toHaveBeenCalled();
  });
});
