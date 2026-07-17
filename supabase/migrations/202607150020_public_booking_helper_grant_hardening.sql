revoke execute on function public.public_booking_token_hash(text)
from public, anon, authenticated;

revoke execute on function public.public_staff_line_is_available(
  uuid,
  uuid,
  uuid,
  timestamptz,
  timestamptz,
  text,
  uuid
)
from public, anon, authenticated;
