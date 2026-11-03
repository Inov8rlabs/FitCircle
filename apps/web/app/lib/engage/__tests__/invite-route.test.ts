import {beforeEach,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
const state=vi.hoisted(()=>({member:true,error:false,authenticated:true,invites:vi.fn(async()=>({results:[{status:'sent',inviteId:'invite'}],sentCount:1}))}));
vi.mock('../../supabase-server',()=>({createServerSupabase:async()=>({auth:{getUser:async()=>({data:{user:state.authenticated?{id:'11111111-1111-4111-8111-111111111111'}:null},error:null})},from:()=>{const q:any={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:state.member?{id:'member'}:null,error:state.error?{}:null})};return q;}})}));
vi.mock('../../services/referral-service',()=>({ReferralService:{getOrCreateCode:async()=> 'SYNTHETIC'}}));
vi.mock('../../services/referral-invite-service',()=>({INVITE_LIMITS:{perRequest:10},ReferralDeliveryUnknownError:class extends Error{},ReferralInviteService:{inviteContacts:state.invites}}));
import {POST} from '../../../api/fitcircles/[id]/invite/route';
const id='22222222-2222-4222-8222-222222222222';
const req=(body:unknown={email:'friend@example.test'},origin='https://app.test')=>new NextRequest(`https://app.test/api/fitcircles/${id}/invite`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
const context={params:Promise.resolve({id})};
beforeEach(()=>{state.member=true;state.error=false;state.authenticated=true;state.invites.mockClear();});
it('denies foreign origins, anonymous callers, nonmembers and unavailable membership before sending',async()=>{
  expect((await POST(req(undefined,'https://foreign.test'),context)).status).toBe(403);
  state.authenticated=false;expect((await POST(req(),context)).status).toBe(401);state.authenticated=true;
  state.member=false;expect((await POST(req(),context)).status).toBe(403);state.error=true;
  expect((await POST(req(),context)).status).toBe(503);expect(state.invites).not.toHaveBeenCalled();
});
it('routes the exact authorized circle and bounded recipient list through the guest consent and occurrence ledger',async()=>{
  expect((await POST(req(),context)).status).toBe(200);
  expect(state.invites).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111',{circleId:id,contacts:[{email:'friend@example.test'}]},expect.any(Function));
  state.invites.mockClear();expect((await POST(req({emails:Array(11).fill('friend@example.test')}),context)).status).toBe(400);
  expect((await POST(req({email:'x'.repeat(20000)}),context)).status).toBe(400);expect(state.invites).not.toHaveBeenCalled();
});
