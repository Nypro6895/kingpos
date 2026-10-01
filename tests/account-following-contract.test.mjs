import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

test("account Following combines followed shops and Beauty profiles", () => {
  const migration = read(
    "supabase/migrations/202608210004_account_beauty_following.sql",
  );
  const accountSocial = read("lib/account-social.ts");
  const moreRoute = read("app/(app)/more/[section]/page.tsx");
  const morePage = read("app/(app)/more/page.tsx");
  const roleNavigation = read("app/role-navigation.ts");

  assert.match(migration, /create table if not exists public\.beauty_profile_follows/);
  assert.match(migration, /create or replace function public\.toggle_account_beauty_profile_follow/);
  assert.match(migration, /create or replace function public\.list_account_following/);
  assert.match(migration, /p_limit integer default 10/);
  assert.match(migration, /'shop'::text as item_target_type/);
  assert.match(migration, /'beauty'::text as item_target_type/);
  assert.match(migration, /union all/);
  assert.match(migration, /normalized\.query_value is null/);
  assert.match(migration, /limit \(select limit_value from normalized\)/);

  assert.match(accountSocial, /export async function getAccountFollowing/);
  assert.match(accountSocial, /p_limit: pageSize/);
  assert.match(accountSocial, /p_offset: offset/);
  assert.match(accountSocial, /export async function removeAccountBeautyProfileFollow/);
  assert.match(accountSocial, /export async function toggleAccountBeautyProfileFollow/);

  assert.match(moreRoute, /const FOLLOWING_PAGE_SIZE = 10/);
  assert.match(moreRoute, /const FOLLOWING_FILTERS/);
  assert.match(moreRoute, /action="\/more\/following"/);
  assert.match(moreRoute, /placeholder="Search following"/);
  assert.match(moreRoute, /function FollowingPagination/);
  assert.match(moreRoute, /getAccountFollowing\(\{/);
  assert.match(moreRoute, /section === "favorite-shop" \|\| section === "favorite-customer"/);
  assert.match(moreRoute, /filter: section === "favorite-shop" \? "shop" : "beauty"/);
  assert.doesNotMatch(moreRoute, /getAccountFavoriteCustomers/);
  assert.doesNotMatch(moreRoute, /FavoriteCustomersSection/);

  assert.match(roleNavigation, /id: "personal-following"/);
  assert.match(roleNavigation, /id: "staff-following"/);
  assert.match(roleNavigation, /href: "\/more\/following"/);
  assert.doesNotMatch(roleNavigation, /personal-favorite-shop|personal-favorite-customer/);
  assert.match(morePage, /personal-following/);
  assert.match(morePage, /staff-following/);
});

test("public Beauty profiles expose account follow state and controls", () => {
  const migration = read(
    "supabase/migrations/202608210004_account_beauty_following.sql",
  );
  const relationshipService = read("lib/beauty-relationship.ts");
  const exploreActions = read("app/explore/actions.ts");
  const followButton = read("app/explore/beauty/beauty-follow-button.tsx");
  const beautyRoute = read("app/(app)/explore/beauty/[profileId]/page.tsx");

  assert.match(migration, /'followerCount'/);
  assert.match(migration, /'isFollowing'/);
  assert.match(migration, /'isSelf'/);
  assert.match(migration, /actor_user_id is not null/);

  assert.match(relationshipService, /followerCount: number/);
  assert.match(relationshipService, /isFollowing: boolean/);
  assert.match(relationshipService, /isSelf: boolean/);
  assert.match(relationshipService, /readNumber\(profile\.followerCount\)/);
  assert.match(relationshipService, /readBoolean\(profile\.isFollowing\)/);
  assert.match(
    relationshipService,
    /await createAuthenticatedSupabaseServerClient\(\)[\s\S]*createSupabaseServerClient\(\)/,
  );

  assert.match(exploreActions, /toggleBeautyProfileFollowAction/);
  assert.match(exploreActions, /toggleAccountBeautyProfileFollow\(profileId\)/);
  assert.match(exploreActions, /revalidatePath\(`\/explore\/beauty\/\$\{profileId\}`\)/);
  assert.match(exploreActions, /revalidatePath\("\/more\/following"\)/);

  assert.match(followButton, /"use client"/);
  assert.match(followButton, /toggleBeautyProfileFollowAction/);
  assert.match(followButton, /aria-pressed=\{isFollowing\}/);
  assert.match(followButton, /isFollowing \? "Following" : "Follow"/);
  assert.match(followButton, /countLabel\(count\)/);

  assert.match(beautyRoute, /<BeautyFollowButton/);
  assert.match(beautyRoute, /!profile\.isSelf/);
  assert.match(beautyRoute, /followerCount=\{profile\.followerCount\}/);
  assert.match(beautyRoute, /initialFollowing=\{profile\.isFollowing\}/);
});
