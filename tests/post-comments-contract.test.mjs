import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = read("supabase/migrations/202608280001_unified_post_comments.sql");
const service = read("lib/post-comments.ts");
const actions = read("app/post-comments/actions.ts");
const thread = read("app/post-comments/post-comment-thread.tsx");
const salonProfile = read("app/salon-profile/salon-profile-view.tsx");
const beautyProfile = read("app/beauty/beauty-profile-client.tsx");
const exploreFeed = read("app/explore/explore-feed.tsx");
const types = read("types/post-comments.ts");

function read(path) {
  return readFileSync(path, "utf8");
}

test("unified post comments migration extends Salon comments across every public post target", () => {
  assert.match(migration, /alter table public\.salon_profile_comments[\s\S]*beauty_post_id uuid references public\.beauty_posts/);
  assert.match(migration, /add column if not exists edited_at timestamptz/);
  assert.match(migration, /salon_profile_comments_one_target_check/);
  assert.match(migration, /\(look_id is not null\)::integer \+/);
  assert.match(migration, /\(update_id is not null\)::integer \+/);
  assert.match(migration, /\(beauty_post_id is not null\)::integer = 1/);
  assert.match(migration, /create index if not exists salon_profile_comments_look_thread_idx/);
  assert.match(migration, /create index if not exists salon_profile_comments_update_thread_idx/);
  assert.match(migration, /create index if not exists salon_profile_comments_beauty_thread_idx/);
  assert.match(migration, /create or replace function public\.count_public_post_comments/);
  assert.match(migration, /create or replace function public\.get_public_post_comments/);
  assert.match(migration, /drop function if exists public\.get_public_salon_profile_comments\(uuid\)/);
  assert.match(migration, /grant execute on function public\.get_public_salon_profile_comments\(uuid\) to anon, authenticated/);
  assert.match(migration, /p_offset integer default 0/);
  assert.match(migration, /p_limit integer default 12/);
  assert.match(migration, /limit clean_limit/);
  assert.match(migration, /Replies can only be one level deep/);
});

test("post comment notifications avoid self-notifications and duplicate recipients", () => {
  assert.match(migration, /create or replace function public\.notify_post_comment_created/);
  assert.match(migration, /after insert on public\.salon_profile_comments/);
  assert.match(migration, /comment_row\.parent_author_user_id <> comment_row\.author_user_id/);
  assert.match(migration, /target_author_user_id <> comment_row\.author_user_id/);
  assert.match(migration, /memberships\.user_id <> comment_row\.author_user_id/);
  assert.match(migration, /select distinct on \(raw_candidates\.recipient_user_id\)/);
  assert.match(migration, /on conflict \(recipient_user_id, event_key\) where event_key is not null do nothing/);
  assert.match(migration, /'post_comment_created:'/);
  assert.match(migration, /\/explore\/salons\//);
  assert.match(migration, /\/explore\/beauty\//);
});

test("server comment domain centralizes auth, pagination, mutation, and cache invalidation", () => {
  assert.match(types, /salon_profile_look/);
  assert.match(types, /salon_profile_update/);
  assert.match(types, /beauty_post/);
  assert.match(service, /export async function loadPostCommentsPage/);
  assert.match(service, /rpc\("get_public_post_comments"/);
  assert.match(service, /export async function createPostComment/);
  assert.match(service, /\.from\("salon_profile_comments"\)[\s\S]*\.insert/);
  assert.match(service, /parent_comment_id: parentCommentId/);
  assert.match(service, /export async function updatePostComment/);
  assert.match(service, /Only the author can edit this comment/);
  assert.match(service, /export async function deletePostComment/);
  assert.match(service, /status: "deleted"/);
  assert.match(service, /export async function hidePostComment/);
  assert.match(service, /status: "hidden"/);
  assert.match(actions, /revalidatePath\("\/notifications"\)/);
  assert.match(actions, /revalidatePath\("\/explore"\)/);
  assert.match(actions, /revalidatePath\("\/beauty"\)/);
});

test("shared comment thread supports fast Facebook-like interaction states", () => {
  assert.match(thread, /PostCommentThreadContent/);
  assert.match(thread, /createOptimisticComment/);
  assert.match(thread, /optimistic-/);
  assert.match(thread, /setTotalCount\(\(current\) => current \+ 1\)/);
  assert.match(thread, /setTotalCount\(\(current\) => Math\.max\(0, current - 1\)\)/);
  assert.match(thread, /Load more/);
  assert.match(thread, /Replying to/);
  assert.match(thread, /Post reply/);
  assert.match(thread, /onEdit/);
  assert.match(thread, /onDelete/);
  assert.match(thread, /onHide/);
  assert.match(thread, /window\.addEventListener\("focus", refreshOnFocus\)/);
});

test("comment thread is wired through profile, staff-authored, beauty, and explore surfaces", () => {
  assert.match(salonProfile, /PostCommentThread/);
  assert.match(salonProfile, /sourceType: "salon_profile_look"/);
  assert.match(salonProfile, /sourceType: "salon_profile_update"/);
  assert.match(salonProfile, /sourceType: "beauty_post"/);
  assert.match(salonProfile, /authorStaffId/);
  assert.match(beautyProfile, /PostCommentThread/);
  assert.match(beautyProfile, /sourceType: "beauty_post"/);
  assert.match(exploreFeed, /PostCommentThread/);
  assert.match(exploreFeed, /exploreCommentTarget/);
  assert.match(exploreFeed, /onCommentCountChange/);
});
