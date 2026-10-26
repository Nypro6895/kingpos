'use server';

import {createAuthenticatedSupabaseServerClient} from '@/lib/supabase/server';
import {revalidatePath} from 'next/cache';

export type BlockedUser = {user_id: string; display_name: string; created_at: string};

export async function loadBlockedUsers(): Promise<BlockedUser[]> {
  const client = await createAuthenticatedSupabaseServerClient();
  if (!client) throw new Error('Sign in to manage blocked users.');
  const {data, error} = await client.rpc('get_my_blocked_users');
  if (error) throw new Error('Blocked users could not be loaded. Please retry.');
  return data ?? [];
}

export async function setUserBlocked(userId: string, blocked: boolean) {
  try {
    const client = await createAuthenticatedSupabaseServerClient();
    if (!client) throw new Error('Sign in to manage blocked users.');
    const {error} = await client.rpc('set_user_block', {p_user_id: userId, p_blocked: blocked});
    if (error) throw new Error(error.message);
    revalidatePath('/explore'); revalidatePath('/beauty'); revalidatePath('/salon-profile');
    return {error: null};
  } catch (error) {
    return {error: error instanceof Error ? error.message : 'Could not update blocked users.'};
  }
}
