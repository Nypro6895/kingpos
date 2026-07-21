insert into public.organization_memberships (
  organization_id,
  user_id,
  role,
  status,
  joined_at,
  created_at,
  updated_at
)
select
  organizations.id,
  organizations.owner_user_id,
  'owner',
  'active',
  coalesce(organizations.created_at, now()),
  coalesce(organizations.created_at, now()),
  now()
from public.organizations
on conflict (organization_id, user_id) do nothing;
