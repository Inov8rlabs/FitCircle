import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { readBoundedBody } from '@inov8r/engage-adapters';
import { ReferralInviteService, ReferralDeliveryUnknownError, INVITE_LIMITS } from '@/lib/services/referral-invite-service';
import { ReferralService } from '@/lib/services/referral-service';
import { createServerSupabase } from '@/lib/supabase-server';

const inputSchema=z.union([
  z.object({email:z.string().email().max(254)}).strict(),
  z.object({emails:z.array(z.string().email().max(254)).min(1).max(INVITE_LIMITS.perRequest)}).strict(),
]);

/** Circle invitations use the same guest opt-out, occurrence and quota ledger as referrals. */
export async function POST(request:NextRequest,context:{params:Promise<{id:string}>}) {
  try {
    if(request.headers.get('origin')!==new URL(request.url).origin) return NextResponse.json({error:'Request origin is not allowed'},{status:403});
    if(request.headers.get('content-type')?.split(';')[0]!=='application/json') return NextResponse.json({error:'JSON request required'},{status:415});
    const supabase=await createServerSupabase();
    const {data:{user},error:authError}=await supabase.auth.getUser();
    if(authError || !user) return NextResponse.json({error:'Unauthorized'},{status:401});
    const {id}=await context.params;
    if(!z.string().uuid().safeParse(id).success) return NextResponse.json({error:'Invalid circle'},{status:400});
    const {data:membership,error:membershipError}=await supabase.from('fitcircle_members').select('id').eq('fitcircle_id',id).eq('user_id',user.id).eq('status','active').maybeSingle();
    if(membershipError) return NextResponse.json({error:'Membership verification is temporarily unavailable'},{status:503});
    if(!membership) return NextResponse.json({error:'Active circle membership is required'},{status:403});
    let body:unknown;
    try {body=JSON.parse((await readBoundedBody(request,16384)).toString('utf8'));}
    catch {return NextResponse.json({error:'Invalid or oversized request'},{status:400});}
    const input=inputSchema.parse(body),batch='emails' in input,emails=batch?input.emails:[input.email];
    const result=await ReferralInviteService.inviteContacts(user.id,{circleId:id,contacts:emails.map(email=>({email}))},uid=>ReferralService.getOrCreateCode(uid));
    const sent=result.results.filter(r=>r.status==='sent').length;
    const failed=result.results.length-sent;
    if(batch) return NextResponse.json({success:failed===0,sent,failed,results:result.results.map(r=>({status:r.status,inviteId:r.inviteId}))});
    const status=result.results[0]?.status;
    if(status==='sent') return NextResponse.json({success:true,message:'Invitation sent'});
    if(status==='already_invited') return NextResponse.json({success:true,message:'This invitation was already recorded'});
    return NextResponse.json({error:status==='rate_limited'?'Invitation limit reached':'Invitation could not be sent',code:status},{status:status==='rate_limited'?429:409});
  } catch(error) {
    if(error instanceof z.ZodError) return NextResponse.json({error:'Invalid input',details:error.issues},{status:400});
    if(error instanceof ReferralDeliveryUnknownError) return NextResponse.json({error:'Delivery could not be confirmed. The invitation is retained to prevent duplicate sending.',code:'DELIVERY_UNKNOWN'},{status:503});
    return NextResponse.json({error:'Invitation service is temporarily unavailable'},{status:503});
  }
}
