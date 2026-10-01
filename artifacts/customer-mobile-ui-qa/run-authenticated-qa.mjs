import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const artifactsDir = path.resolve("artifacts/customer-mobile-ui-qa");
const baseUrl = process.env.CUSTOMER_QA_BASE_URL ?? "http://127.0.0.1:3002";
const qaScript =
  process.env.CUSTOMER_QA_SCRIPT ??
  "artifacts/customer-mobile-ui-qa/browser-qa.mjs";
const marker = "codex-customer-mobile-ui-qa";
const authUserId = randomUUID();
const email = `${marker}-${Date.now()}@example.com`;
const password = `Codex-Customer-Mobile-${randomUUID()}!`;
const organizationName =
  "Codex Customer Mobile QA Organization With A Very Long Display Name";
const salonName =
  "Codex Customer Mobile QA Salon With A Name Longer Than Thirty Characters";

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function runSupabaseSql(name, sql) {
  const filePath = path.join(artifactsDir, name);

  await mkdir(artifactsDir, { recursive: true });
  await writeFile(filePath, `${sql.trim()}\n`);

  try {
    const cliFilePath = path.relative(process.cwd(), filePath).replaceAll("\\", "/");
    const command =
      process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "npx";
    const args =
      process.platform === "win32"
        ? [
            "/d",
            "/s",
            "/c",
            `npx supabase db query --linked --file ${cliFilePath}`,
          ]
        : ["supabase", "db", "query", "--linked", "--file", cliFilePath];

    try {
      await execFileAsync(command, args, {
        cwd: process.cwd(),
        env: {
          ...process.env,
          SUPABASE_TELEMETRY_DISABLED: "1",
        },
        maxBuffer: 1024 * 1024 * 16,
        windowsHide: true,
      });
    } catch (error) {
      const details = [
        error instanceof Error ? error.message : String(error),
        typeof error?.stdout === "string" ? error.stdout : "",
        typeof error?.stderr === "string" ? error.stderr : "",
      ]
        .filter(Boolean)
        .join("\n");
      throw new Error(details);
    }
  } finally {
    await unlink(filePath).catch(() => {});
  }
}

async function runBrowserQa() {
  const command = process.execPath;

  await execFileAsync(
    command,
    [qaScript],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CUSTOMER_QA_BASE_URL: baseUrl,
        CUSTOMER_QA_EMAIL: email,
        CUSTOMER_QA_PASSWORD: password,
      },
      maxBuffer: 1024 * 1024 * 64,
      windowsHide: true,
    },
  );
}

function seedSql() {
  return `
do $qa$
declare
  qa_auth_user_id uuid := ${sqlLiteral(authUserId)}::uuid;
  qa_email text := ${sqlLiteral(email)};
  qa_public_user_id uuid;
  qa_organization_id uuid;
  qa_owner_role_id uuid;
begin
  with qa_orgs as (
    select id, owner_user_id
    from public.organizations
    where legal_name = ${sqlLiteral(marker)}
  ),
  cleaned_locations as (
    update public.locations
    set
      status = 'inactive',
      name = 'Codex Customer Mobile QA cleaned salon',
      updated_at = now()
    where organization_id in (select id from qa_orgs)
    returning id
  ),
  cleaned_memberships as (
    update public.organization_memberships
    set
      status = 'removed',
      updated_at = now()
    where organization_id in (select id from qa_orgs)
    returning id
  ),
  cleaned_orgs as (
    update public.organizations
    set
      status = 'archived',
      name = 'Codex Customer Mobile QA cleaned organization',
      legal_name = 'codex-customer-mobile-ui-qa-cleaned-' || left(id::text, 8),
      updated_at = now()
    where id in (select id from qa_orgs)
    returning owner_user_id
  )
  update public.users
  set
    auth_user_id = null,
    email = null,
    phone = null,
    first_name = null,
    last_name = null,
    display_name = 'Codex Customer Mobile QA cleaned user',
    avatar_url = null,
    status = 'deleted',
    updated_at = now()
  where id in (select owner_user_id from cleaned_orgs);

  update public.users
  set
    auth_user_id = null,
    email = null,
    phone = null,
    first_name = null,
    last_name = null,
    display_name = 'Codex Customer Mobile QA cleaned user',
    avatar_url = null,
    status = 'deleted',
    updated_at = now()
  where email like ${sqlLiteral(`${marker}-%@example.com`)};

  delete from auth.users
  where email like ${sqlLiteral(`${marker}-%@example.com`)};

  insert into auth.users (
    aud,
    confirmation_token,
    created_at,
    email,
    email_change,
    email_change_confirm_status,
    email_change_token_current,
    email_change_token_new,
    email_confirmed_at,
    encrypted_password,
    id,
    instance_id,
    is_anonymous,
    is_sso_user,
    raw_app_meta_data,
    raw_user_meta_data,
    reauthentication_token,
    recovery_token,
    role,
    updated_at
  )
  values (
    'authenticated',
    '',
    now(),
    qa_email,
    '',
    0,
    '',
    '',
    now(),
    crypt(${sqlLiteral(password)}, gen_salt('bf')),
    qa_auth_user_id,
    coalesce(
      (select instance_id from auth.users where instance_id is not null limit 1),
      '00000000-0000-0000-0000-000000000000'::uuid
    ),
    false,
    false,
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object(
      'display_name', 'Nguyen Alexandra Truong',
      'email', qa_email,
      'email_verified', true,
      'phone_verified', false,
      'sub', qa_auth_user_id::text
    ),
    '',
    '',
    'authenticated',
    now()
  );

  insert into auth.identities (
    created_at,
    identity_data,
    last_sign_in_at,
    provider,
    provider_id,
    user_id,
    updated_at
  )
  values (
    now(),
    jsonb_build_object(
      'sub', qa_auth_user_id::text,
      'email', qa_email,
      'email_verified', true,
      'phone_verified', false
    ),
    now(),
    'email',
    qa_auth_user_id::text,
    qa_auth_user_id,
    now()
  );

  select id
  into qa_public_user_id
  from public.users
  where auth_user_id = qa_auth_user_id
  limit 1;

  if qa_public_user_id is null then
    insert into public.users (
      auth_user_id,
      email,
      phone,
      display_name,
      status,
      language,
      timezone
    )
    values (
      qa_auth_user_id,
      qa_email,
      '5554443333',
      'Nguyen Alexandra Truong',
      'active',
      'en',
      'America/Chicago'
    )
    returning id into qa_public_user_id;
  end if;

  update public.users
  set
    email = qa_email,
    phone = '5554443333',
    display_name = 'Nguyen Alexandra Truong',
    status = 'active',
    language = 'en',
    timezone = 'America/Chicago',
    updated_at = now()
  where id = qa_public_user_id;

  insert into public.organizations (
    legal_name,
    name,
    owner_user_id,
    status
  )
  values (
    ${sqlLiteral(marker)},
    ${sqlLiteral(organizationName)},
    qa_public_user_id,
    'active'
  )
  returning id into qa_organization_id;

  select id
  into qa_owner_role_id
  from public.roles
  where organization_id = qa_organization_id
    and code = 'OWNER'
  limit 1;

  insert into public.organization_memberships (
    joined_at,
    organization_id,
    role,
    role_id,
    status,
    user_id
  )
  values (
    now(),
    qa_organization_id,
    'owner',
    qa_owner_role_id,
    'active',
    qa_public_user_id
  );

  insert into public.locations (
    address_line1,
    city,
    country,
    name,
    organization_id,
    phone,
    postal_code,
    state,
    status
  )
  values (
    '8333 W Appleton Ave',
    'Milwaukee',
    'US',
    ${sqlLiteral(salonName)},
    qa_organization_id,
    '4145551234',
    '53218',
    'WI',
    'active'
  );
end
$qa$;
`;
}

function cleanupSql() {
  return `
with qa_orgs as (
  select id, owner_user_id
  from public.organizations
  where legal_name like ${sqlLiteral(`${marker}%`)}
     or name like 'Codex Customer Mobile QA%'
),
qa_users as (
  select owner_user_id as id
  from qa_orgs
  union
  select user_id as id
  from public.organization_memberships
  where organization_id in (select id from qa_orgs)
  union
  select id
  from public.users
  where auth_user_id = ${sqlLiteral(authUserId)}::uuid
     or email = ${sqlLiteral(email)}
     or email like ${sqlLiteral(`${marker}-%@example.com`)}
),
deleted_locations as (
  delete from public.locations
  where organization_id in (select id from qa_orgs)
     or name like 'Codex Customer Mobile QA%'
  returning id
),
role_update as (
  update public.roles
  set is_system = false
  where organization_id in (select id from qa_orgs)
  returning id
),
deleted_memberships as (
  delete from public.organization_memberships
  where organization_id in (select id from qa_orgs)
  returning id
),
deleted_orgs as (
  delete from public.organizations
  where id in (select id from qa_orgs)
  returning id
),
deleted_public_users as (
  delete from public.users
  where id in (select id from qa_users)
     or auth_user_id = ${sqlLiteral(authUserId)}::uuid
     or email = ${sqlLiteral(email)}
     or email like ${sqlLiteral(`${marker}-%@example.com`)}
  returning id
),
deleted_auth_users as (
  delete from auth.users
  where id = ${sqlLiteral(authUserId)}::uuid
     or email = ${sqlLiteral(email)}
     or email like ${sqlLiteral(`${marker}-%@example.com`)}
  returning id
)
select
  (select count(*) from deleted_locations) as deleted_locations,
  (select count(*) from role_update) as roles_unlocked,
  (select count(*) from deleted_memberships) as deleted_memberships,
  (select count(*) from deleted_orgs) as deleted_orgs,
  (select count(*) from deleted_public_users) as deleted_public_users,
  (select count(*) from deleted_auth_users) as deleted_auth_users,
  (
    select count(*)
    from auth.users
    where email like ${sqlLiteral(`${marker}-%@example.com`)}
  ) as remaining_auth_users,
  (
    select count(*)
    from public.users
    where email like ${sqlLiteral(`${marker}-%@example.com`)}
  ) as remaining_public_users,
  (
    select count(*)
    from public.organizations
    where legal_name like ${sqlLiteral(`${marker}%`)}
       or name like 'Codex Customer Mobile QA%'
  ) as remaining_organizations,
  (
    select count(*)
    from public.locations
    where name like 'Codex Customer Mobile QA%'
  ) as remaining_locations;
`;
}

async function run() {
  let qaError = null;

  try {
    await runSupabaseSql("qa-seed.sql", seedSql());
    await runBrowserQa();
  } catch (error) {
    qaError = error;
  } finally {
    await runSupabaseSql("qa-cleanup.sql", cleanupSql());
  }

  if (qaError) {
    throw qaError;
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
