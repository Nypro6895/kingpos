-- Narrow app notification table access after creation. RLS already scopes rows;
-- this limits authenticated users to reading their notifications and marking
-- them read through the intended column.

revoke all privileges on table public.app_notifications from anon;
revoke delete, insert, truncate, references, trigger on table public.app_notifications
from authenticated;
revoke update on table public.app_notifications from authenticated;

grant select on table public.app_notifications to authenticated;
grant update (read_at) on table public.app_notifications to authenticated;
