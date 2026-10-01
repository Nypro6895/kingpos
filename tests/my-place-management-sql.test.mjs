import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import test from "node:test";

test(
  "My Place: scoped salon edits and consent-based account membership",
  {
    skip: !process.env.PGLITE_MODULE_PATH,
  },
  async () => {
    const { PGlite } = await import(
      pathToFileURL(process.env.PGLITE_MODULE_PATH).href
    );
    const db = new PGlite();
    const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    const actor = async (n) =>
      db.query("select set_config('test.actor',$1,false)", [id(n)]);
    const result = async (sql, args = []) =>
      (await db.query(sql, args)).rows[0].result;
    const member = (
      operation,
      role = 12,
      membership = null,
      email = null,
      account = 10,
    ) =>
      result("select public.my_place_save_member($1,$2,$3,$4,$5) as result", [
        id(account),
        role ? id(role) : null,
        email,
        membership,
        operation,
      ]);
    try {
      await db.exec(`
      create role anon; create role authenticated;
      create table users(id uuid primary key, email text, display_name text, status text default 'active');
      create table accounts(id uuid primary key, name text, status text default 'active');
      create table roles(id uuid primary key, account_id uuid, name text, code text);
      create table permissions(id uuid primary key, code text);
      create table role_permissions(role_id uuid, permission_id uuid);
      create table account_memberships(id uuid primary key default gen_random_uuid(), account_id uuid,
        user_id uuid,role_id uuid,status text,joined_at timestamptz,created_at timestamptz default now(),unique(account_id,user_id));
      create table locations(id uuid primary key,account_id uuid,name text,phone text,address_line1 text,
        address_line2 text,city text,state text,postal_code text,country text,status text default 'active',geocoding_status text);
      create table salon_settings(salon_id uuid unique,business_name text,phone text,address_line1 text,
        address_line2 text,city text,state text,postal_code text,country text,public_discovery_enabled boolean default false);
      create table staff_salon_connection_requests(id uuid, salon_id uuid, account_user_id uuid, direction text,
        target_email_normalized text,target_phone_e164 text,requested_job_title text,message text,status text,
        created_at timestamptz default now(),expires_at timestamptz);
      create function current_public_user_id() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
      create function user_belongs_to_account(target_account_id uuid) returns boolean language sql as $$select exists(
        select 1 from account_memberships where account_id=target_account_id and user_id=current_public_user_id() and status='active')$$;
      create function user_has_salon_permission(target_salon_id uuid, permission_codes text[]) returns boolean language sql as $$select exists(
        select 1 from locations l join account_memberships m on m.account_id=l.account_id join roles r on r.id=m.role_id
        where l.id=target_salon_id and m.user_id=current_public_user_id() and m.status='active' and r.code='OWNER')$$;
      insert into users(id,email,display_name) values ('${id(1)}','owner@test.invalid','Owner'),('${id(2)}','member@test.invalid','Member'),('${id(3)}','outsider@test.invalid','Outsider');
      insert into accounts(id,name) values('${id(10)}','Business A'),('${id(20)}','Business B');
      insert into roles values('${id(11)}','${id(10)}','Owner','OWNER'),('${id(12)}','${id(10)}','Manager','MANAGER'),('${id(21)}','${id(20)}','Owner','OWNER'),('${id(22)}','${id(20)}','Manager','MANAGER');
      insert into account_memberships(id,account_id,user_id,role_id,status) values('${id(31)}','${id(10)}','${id(1)}','${id(11)}','active'),('${id(32)}','${id(20)}','${id(3)}','${id(21)}','active');
      insert into locations(id,account_id,name) values('${id(40)}','${id(10)}','Salon A'),('${id(41)}','${id(20)}','Salon B');
      insert into staff_salon_connection_requests(id,salon_id,account_user_id,direction,status) values
        ('${id(50)}','${id(40)}','${id(2)}','staff_application','pending'),
        ('${id(51)}','${id(41)}','${id(2)}','staff_application','pending');
    `);
      await db.exec(
        readFileSync(
          "supabase/migrations/202609230004_my_place_management.sql",
          "utf8",
        ),
      );
      assert.equal(
        await result(
          "select has_function_privilege('anon','my_place_update_salon(uuid,jsonb)','EXECUTE') as result",
        ),
        false,
      );
      assert.equal(
        await result(
          "select has_function_privilege('anon','my_place_save_member(uuid,uuid,text,uuid,text)','EXECUTE') as result",
        ),
        false,
      );
      await actor(3);
      await assert.rejects(
        member("invite", 12, null, "member@test.invalid"),
        /Only an active/,
      );
      await assert.rejects(
        result("select my_place_account_details($1) as result", [id(10)]),
        /do not have access/,
      );
      await actor(1);
      const reviews = await result(
        "select my_place_staff_requests() as result",
      );
      assert.equal(reviews.length, 1);
      assert.equal(reviews[0].label, "Salon A");
      assert.match(reviews[0].detail, /Member/);
      await assert.rejects(
        member("invite", 22, null, "member@test.invalid"),
        /non-owner role/,
      );
      await assert.rejects(
        member("invite", 11, null, "member@test.invalid"),
        /non-owner role/,
      );
      await assert.rejects(member("role", 12, id(31)), /Owner memberships/);
      await member("invite", 12, null, "MEMBER@test.invalid");
      const details = await result(
        "select my_place_account_details($1) as result",
        [id(10)],
      );
      assert.equal(details.canManage, true);
      const invited = details.members.find(
        (m) => m.email === "member@test.invalid",
      );
      assert.equal(invited.status, "invited");
      await assert.rejects(
        member("invite", 12, null, "member@test.invalid"),
        /already a member/,
      );
      await actor(2);
      assert.equal(
        await result("select user_belongs_to_account($1) as result", [id(10)]),
        false,
      );
      assert.equal(
        (await result("select my_place_account_invitations() as result"))
          .length,
        1,
      );
      await actor(3);
      await assert.rejects(
        result(
          "select my_place_respond_account_invitation($1,true) as result",
          [invited.id],
        ),
        /not available/,
      );
      await actor(2);
      await result(
        "select my_place_respond_account_invitation($1,true) as result",
        [invited.id],
      );
      assert.equal(
        await result("select user_belongs_to_account($1) as result", [id(10)]),
        true,
      );
      assert.equal(
        (
          await result("select my_place_account_details($1) as result", [
            id(10),
          ])
        ).canManage,
        false,
      );
      await assert.rejects(
        member("invite", 12, null, "outsider@test.invalid"),
        /Only an active/,
      );
      await assert.rejects(
        result(
          "select my_place_respond_account_invitation($1,true) as result",
          [invited.id],
        ),
        /no longer pending/,
      );
      await actor(1);
      await assert.rejects(
        member("revoke", null, invited.id),
        /no longer pending/,
      );
      await member("invite", 12, null, "outsider@test.invalid");
      const pending = (
        await result("select my_place_account_details($1) as result", [id(10)])
      ).members.find((m) => m.email === "outsider@test.invalid");
      await member("revoke", null, pending.id);
      await actor(3);
      await assert.rejects(
        result(
          "select my_place_respond_account_invitation($1,true) as result",
          [pending.id],
        ),
        /no longer pending/,
      );
      await actor(1);
      const values = {
        name: "Renamed A",
        phone: "5551234567",
        address_line1: "1 Main St",
        address_line2: "Suite 2",
        city: "Austin",
        state: "TX",
        postal_code: "78701",
        country: "US",
      };
      await result("select my_place_update_salon($1,$2) as result", [
        id(40),
        JSON.stringify(values),
      ]);
      const saved = (
        await db.query(
          "select l.name,s.business_name,l.city,s.city as public_city from locations l join salon_settings s on s.salon_id=l.id where l.id=$1",
          [id(40)],
        )
      ).rows[0];
      assert.equal(saved.name, saved.business_name);
      assert.equal(saved.city, saved.public_city);
      assert.equal(saved.name, "Renamed A");
      await assert.rejects(
        result("select my_place_update_salon($1,$2) as result", [
          id(41),
          JSON.stringify(values),
        ]),
        /do not have permission/,
      );
      await db.exec(
        `update salon_settings set public_discovery_enabled=true where salon_id='${id(40)}'`,
      );
      await assert.rejects(
        result("select my_place_update_salon($1,$2) as result", [
          id(40),
          JSON.stringify({ ...values, phone: "" }),
        ]),
        /Published salons/,
      );
      assert.equal(
        (
          await db.query("select phone from salon_settings where salon_id=$1", [
            id(40),
          ])
        ).rows[0].phone,
        values.phone,
      );
      await db.exec(
        `update locations set status='permanently_closed' where id='${id(40)}'`,
      );
      await assert.rejects(
        result("select my_place_update_salon($1,$2) as result", [
          id(40),
          JSON.stringify(values),
        ]),
        /Only salons/,
      );
      await db.exec(`update users set status='suspended' where id='${id(1)}'`);
      await assert.rejects(
        member("invite", 12, null, "outsider@test.invalid"),
        /Only an active/,
      );
    } finally {
      await db.close();
    }
  },
);
