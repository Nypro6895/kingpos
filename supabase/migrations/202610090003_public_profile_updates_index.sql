-- Directory reference posts usually have no media and cannot use the Explore
-- media-only updates index. Keep single-profile reading bounded to that salon.
CREATE INDEX IF NOT EXISTS salon_profile_updates_public_salon_idx
ON public.salon_profile_updates(salon_id,published_at DESC NULLS LAST,id)
WHERE status='published';
