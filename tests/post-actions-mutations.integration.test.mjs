import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { setup, actor, uuid } from "./helpers/post-comment-identity-fixture.mjs";

const sources = [
  { type: "beauty_post", table: "beauty_posts", prefix: "10000000" },
  { type: "salon_profile_look", table: "salon_profile_looks", prefix: "20000000" },
  { type: "salon_profile_update", table: "salon_profile_updates", prefix: "30000000" },
];
const migration = "supabase/migrations/20261017194500_post_actions_canonical_caption.sql";
async function database() {
  const db = await setup();
  await db.exec(`
    alter table beauty_posts add column edited_at timestamptz;
    alter table locations add column account_id uuid;
    create table roles(id uuid primary key,code text);
    create table account_memberships(account_id uuid,user_id uuid,role_id uuid,status text);
    insert into locations(id,account_id) values('${uuid(1, "40000000")}','${uuid(1, "50000000")}');
    insert into roles(id,code) values('${uuid(1, "60000000")}','OWNER'),('${uuid(2, "60000000")}','MANAGER');
    insert into account_memberships(account_id,user_id,role_id,status) values('${uuid(1, "50000000")}','${uuid(1)}','${uuid(1, "60000000")}','active');
  `);
  await db.exec(readFileSync("supabase/migrations/202610030003_salon_website_feature_selection.sql", "utf8"));
  await db.exec(readFileSync(migration, "utf8"));
  return db;
}
async function insert(db, source, n, caption = "Complete caption with details that are absent from its preview.") {
  const id = uuid(n, source.prefix);
  // Seed existing records as maintenance; the actions under test run as the signed-in actor.
  await db.query("select set_config('test.role','service_role',false)");
  try {
    if (source.type === "beauty_post") {
      await db.query("insert into beauty_posts(id,author_user_id,caption) values($1,$2,$3)", [id, uuid(1), caption]);
    } else {
      await db.query(`insert into ${source.table}(id,salon_id,author_user_id,title,caption) values($1,$2,$3,'Short title',$4)`, [id, uuid(1, "40000000"), uuid(1), caption]);
    }
  } finally { await db.query("select set_config('test.role','authenticated',false)"); }
  return id;
}
async function action(db, source, id, mode, payload = {}) {
  return (await db.query("select post_safety_action($1,$2,$3,$4) result", [source.type, id, mode, JSON.stringify(payload)])).rows[0].result;
}
async function row(db, source, id) {
  return (await db.query(`select * from ${source.table} where id=$1`, [id])).rows[0];
}

test("the shared database boundary authorizes owners, returns their full caption and rejects stranger mutations for every post type", { timeout: 120000 }, async () => {
  const db = await database();
  try {
    for (const source of sources) {
      const id = await insert(db, source, 1);
      const original = await row(db, source, id);
      await actor(db, 2);
      const stranger = await action(db, source, id, "permissions");
      assert.equal(stranger.canManage, false);
      assert.equal(Object.hasOwn(stranger, "caption"), false, "Caption lookup must not expose private editing content to strangers");
      for (const mode of ["edit", "archive", "delete"]) {
        await assert.rejects(action(db, source, id, mode, { caption: "Unauthorized edit" }), /cannot manage/);
      }
      assert.deepEqual(await row(db, source, id), original, "Forbidden mutations must not change caption, status or editing timestamp");
      await actor(db, 1);
      const owner = await action(db, source, id, "permissions");
      assert.equal(owner.canManage, true);
      assert.equal(owner.caption, (await row(db, source, id)).caption);
      const saved = await action(db, source, id, "edit", { caption: "  Updated complete caption  " });
      assert.equal(saved.ok, true);
      assert.equal(saved.caption, "Updated complete caption");
      assert.equal((await row(db, source, id)).caption, saved.caption);
      if (source.type === "beauty_post") assert.ok((await row(db, source, id)).edited_at, "Beauty retains its edited timestamp");
      await assert.rejects(action(db, source, id, "edit", { caption: "x".repeat(2201) }), /Caption is too long/);
      assert.equal((await row(db, source, id)).caption, saved.caption, "Validation failure must not alter the saved caption");
      assert.equal((await action(db, source, id, "edit", { caption: "   " })).caption, null);
      assert.equal((await row(db, source, id)).caption, null);
    }
  } finally { await db.close(); }
});

test("editing held content does not release its moderation hold or republish it", { timeout: 120000 }, async () => {
  const db = await database();
  try {
    for (const source of sources) {
      const id = await insert(db, source, 1, "sexual content");
      const before = await row(db, source, id);
      assert.equal(before.safety_hold, true);
      const saved = await action(db, source, id, "edit", { caption: "A corrected manicure caption" });
      assert.equal(saved.caption, "A corrected manicure caption");
      const after = await row(db, source, id);
      assert.equal(after.safety_hold, true, "Only the review workflow may release an existing safety hold");
      assert.equal(source.type === "beauty_post" ? after.visibility : after.status, source.type === "beauty_post" ? "self" : "draft");
    }
  } finally { await db.close(); }
});

test("shared archive and delete retain each source's storage semantics and affect only the selected record", { timeout: 120000 }, async () => {
  const db = await database();
  try {
    for (const source of sources) {
      const selected = await insert(db, source, 1);
      const other = await insert(db, source, 2, "The other post stays public.");
      await action(db, source, selected, "archive");
      const archived = await row(db, source, selected);
      assert.equal(source.type === "beauty_post" ? archived.visibility : archived.status, source.type === "beauty_post" ? "self" : "archived");
      assert.equal(archived.caption, "Complete caption with details that are absent from its preview.");
      const otherBefore = await row(db, source, other);
      assert.equal(source.type === "beauty_post" ? otherBefore.visibility : otherBefore.status, source.type === "beauty_post" ? "public" : "published");
      await action(db, source, selected, "delete");
      const deleted = await row(db, source, selected);
      if (source.type === "beauty_post") {
        assert.ok(deleted.deleted_at, "Beauty deletion remains soft so linked records keep their history");
        await assert.rejects(action(db, source, selected, "edit", { caption: "Restore by editing" }), /deleted|unavailable|not found/i);
      } else {
        assert.equal(deleted, undefined, "Salon deletion still removes the selected content record");
      }
      assert.deepEqual(await row(db, source, other), otherBefore);
    }
  } finally { await db.close(); }
});

test("Salon manager permissions stay limited to Salon content and restricted accounts cannot mutate posts", { timeout: 120000 }, async () => {
  const db = await database();
  try {
    await db.exec(`create or replace function user_can_manage_salon(uuid) returns boolean language sql stable as $$select current_public_user_id()='${uuid(3)}'::uuid and $1='${uuid(1, "40000000")}'::uuid$$;`);
    for (const source of sources) {
      const id = await insert(db, source, 1);
      await actor(db, 3);
      const manager = await action(db, source, id, "permissions");
      assert.equal(manager.canManage, source.type !== "beauty_post");
      if (source.type === "beauty_post") {
        await assert.rejects(action(db, source, id, "edit", { caption: "Manager edit" }), /cannot manage/);
      } else {
        assert.equal((await action(db, source, id, "edit", { caption: "Manager edit" })).caption, "Manager edit");
      }
      await actor(db, 1);
      await db.query("update users set status='suspended' where id=$1", [uuid(1)]);
      await assert.rejects(action(db, source, id, "edit", { caption: "Restricted edit" }), /restricted/);
      await db.query("update users set status='active' where id=$1", [uuid(1)]);
    }
  } finally { await db.close(); }
});

test("shared feature selection preserves owner restrictions, the previous pin and daily selection behavior", { timeout: 120000 }, async () => {
  const db = await database();
  const look = sources[1];
  const update = sources[2];
  const salonId = uuid(1, "40000000");
  try {
    const selected = await insert(db, look, 1, "Owner photo selected for the website.");
    const previous = await insert(db, look, 2, "The previously selected website photo.");
    await db.query("update salon_profile_looks set media_path='owner/look.webp' where id=any($1::uuid[])", [[selected, previous]]);
    await db.query("update salon_profile_looks set is_pinned=true where id=$1", [previous]);
    await db.query("insert into salon_website_feature_selection(salon_id,look_id,selected_day) values($1,$2,current_date)", [salonId, previous]);
    assert.equal((await action(db, look, selected, "permissions")).canFeature, true);
    assert.equal((await action(db, look, selected, "permissions")).isPinned, false);
    assert.equal((await action(db, look, selected, "feature")).isPinned, true);
    assert.equal((await row(db, look, selected)).is_pinned, true);
    assert.equal((await action(db, look, selected, "permissions")).isPinned, true);
    assert.equal((await row(db, look, previous)).is_pinned, false, "The previous owner selection must be replaced");
    assert.equal((await db.query("select count(*)::int n from salon_website_feature_selection where salon_id=$1", [salonId])).rows[0].n, 0, "Manual selection clears the cached daily choice");
    assert.equal((await action(db, look, selected, "feature")).isPinned, false);
    assert.equal((await row(db, look, selected)).is_pinned, false);
    assert.equal((await action(db, look, selected, "permissions")).isPinned, false);

    await db.query("insert into salon_settings(salon_id) values($1)", [salonId]);
    const updateId = await insert(db, update, 1, "Salon update with a new cover photo.");
    await db.query("update salon_profile_updates set media_path='owner/update.webp' where id=$1", [updateId]);
    const updatePermissions = await action(db, update, updateId, "permissions");
    assert.equal(updatePermissions.canFeature, true, JSON.stringify({ row: await row(db, update, updateId), permissions: updatePermissions }));
    await action(db, update, updateId, "feature");
    assert.equal((await db.query("select public_profile_cover_path from salon_settings where salon_id=$1", [salonId])).rows[0].public_profile_cover_path, "owner/update.webp");

    await db.query("insert into account_memberships(account_id,user_id,role_id,status) values($1,$2,$3,'active')", [uuid(1, "50000000"), uuid(3), uuid(2, "60000000")]);
    for (const source of [look, update]) {
      const managerOwned = await insert(db, source, 3, `Manager photo for ${source.type}.`);
      await db.query(`update ${source.table} set author_user_id=$1,media_path='staff/photo.webp' where id=$2`, [uuid(3), managerOwned]);
      await actor(db, 3);
      const permission = await action(db, source, managerOwned, "permissions");
      assert.equal(permission.canManage, true, "A manager keeps the ability to edit their own post");
      assert.equal(permission.canFeature, false, "Owning the post does not grant the owner-only website feature privilege");
      const before = await row(db, source, managerOwned);
      await assert.rejects(action(db, source, managerOwned, "feature"), /Only the salon owner/);
      assert.deepEqual(await row(db, source, managerOwned), before);
      await actor(db, 1);
      await assert.rejects(action(db, source, managerOwned, "feature"), /Only the salon owner/, "A salon owner must not select another author's post");

      const owned = source === look ? selected : updateId;
      await db.query("update users set status='suspended' where id=$1", [uuid(1)]);
      assert.equal((await action(db, source, owned, "permissions")).canFeature, false);
      await assert.rejects(action(db, source, owned, "feature"), /restricted/);
      await db.query("update users set status='active' where id=$1", [uuid(1)]);
      await db.query(`update ${source.table} set caption='sexual content' where id=$1`, [owned]);
      assert.equal((await action(db, source, owned, "permissions")).canFeature, false);
      const held = await row(db, source, owned);
      await assert.rejects(action(db, source, owned, "feature"), /Only the salon owner/);
      assert.deepEqual(await row(db, source, owned), held, "Feature must not bypass the safety hold");
    }
    assert.equal((await db.query("select public_profile_cover_path from salon_settings where salon_id=$1", [salonId])).rows[0].public_profile_cover_path, "owner/update.webp", "Denied feature attempts must keep the existing website cover");
  } finally { await db.close(); }
});

test("the shared authority preserves existing custom-role content grants without granting Beauty or feature rights", { timeout: 120000 }, async () => {
  const db = await database();
  try {
    await db.exec(`create or replace function user_has_salon_permission(uuid,text[]) returns boolean language sql stable as $$
      select current_public_user_id()='${uuid(4)}'::uuid
        and $1='${uuid(1, "40000000")}'::uuid
        and $2=array['salon_profile.content.manage']::text[]
        and current_setting('test.custom_grant',true)='yes'
    $$;set test.custom_grant='yes';`);
    await actor(db, 4);
    for (const source of sources) {
      const selected = await insert(db, source, 1, `A post managed through a custom role for ${source.type}.`);
      if (source.type === "beauty_post") {
        assert.equal((await action(db, source, selected, "permissions")).canManage, false);
        await assert.rejects(action(db, source, selected, "delete"), /cannot manage/);
        continue;
      }
      const permission = await action(db, source, selected, "permissions");
      assert.equal(permission.canManage, true, "The shared menu must retain the permission already granted by Salon content management");
      assert.equal(permission.canFeature, false);
      assert.equal((await action(db, source, selected, "edit", { caption: "An authorized team edit" })).caption, "An authorized team edit");
      await action(db, source, selected, "archive");
      assert.equal((await row(db, source, selected)).status, "archived");
      await action(db, source, selected, "delete");
      assert.equal(await row(db, source, selected), undefined);

      const foreign = await insert(db, source, 2, `Another salon's ${source.type} post.`);
      await db.query(`update ${source.table} set salon_id=$1 where id=$2`, [uuid(2, "40000000"), foreign]);
      const beforeForeign = await row(db, source, foreign);
      await assert.rejects(action(db, source, foreign, "delete"), /cannot manage/);
      assert.deepEqual(await row(db, source, foreign), beforeForeign);
      const revoked = await insert(db, source, 3, `A revoked grant on ${source.type}.`);
      await db.exec("set test.custom_grant='no'");
      assert.equal((await action(db, source, revoked, "permissions")).canManage, false);
      await assert.rejects(action(db, source, revoked, "archive"), /cannot manage/);
      assert.equal((await row(db, source, revoked)).status, "published");
      await db.exec("set test.custom_grant='yes'");
    }
  } finally { await db.close(); }
});
