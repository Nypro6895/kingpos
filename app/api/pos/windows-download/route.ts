import { cookies } from 'next/headers';
import { createHash } from 'node:crypto';
import { ACCOUNT_LOGIN_SESSION_COOKIE } from '@/lib/account-security-shared';
import { createAuthenticatedSupabaseServerClient, getAccessTokenFromRequest } from '@/lib/supabase/server';
import { getCurrentKingUser } from '@/lib/users/current-user';
import { getWindowsPosRelease } from '@/lib/windows-pos-release';

export async function POST(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) return Response.json({}, { status: 403 });
  const [user, client] = await Promise.all([getCurrentKingUser(), createAuthenticatedSupabaseServerClient()]);
  if (!user || user.status !== 'active' || !client) return Response.json({}, { status: 401 });
  const input = await request.json().catch(() => null);
  if (!input || !['check','download','later','never'].includes(input.action)) return Response.json({}, { status: 400 });
  const table = client.from('windows_pos_download_preferences');
  if (input.action === 'check') {
    const release = await getWindowsPosRelease();
    if (!release) return Response.json({show:false,release:null});
    const session = (await cookies()).get(ACCOUNT_LOGIN_SESSION_COOKIE)?.value;
    const token = session || await getAccessTokenFromRequest();
    const sessionKey = token ? createHash('sha256').update(token).digest('hex') : null;
    const {data:show,error} = await client.rpc('claim_windows_pos_download_prompt',{p_session:sessionKey,p_pos:input.pos===true});
    if(error)return Response.json({error:'Download reminder is unavailable.'},{status:503});
    return Response.json({ show, release }, { headers:{'Cache-Control':'no-store'} });
  }
  const changes = input.action === 'download' ? { downloaded_at:new Date().toISOString(), remind_after_download:false }
    : input.action === 'later' ? { never_remind:false, remind_after_download:true }
    : { never_remind:true, remind_after_download:false };
  const { error } = await table.upsert({user_id:user.id, ...changes, pending:false, updated_at:new Date().toISOString()});
  return Response.json(error ? {error:'Could not save your choice. Please try again.'} : {ok:true}, {status:error?503:200});
}
