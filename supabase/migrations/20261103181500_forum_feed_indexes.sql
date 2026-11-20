-- Match the pinned + chronological keyset used by all three filtered feeds.
-- Applied before opening the new forum; these tables contain no existing product records.
begin;
drop index public.forum_feed;
drop index public.forum_section_feed;
drop index public.forum_state_feed;
create index forum_feed on public.forum_topics(pinned desc,created_at desc,id desc) where deleted_at is null;
create index forum_section_feed on public.forum_topics(section_id,pinned desc,created_at desc,id desc) where deleted_at is null;
create index forum_state_feed on public.forum_topics(state,pinned desc,created_at desc,id desc) where deleted_at is null;
create index forum_removed_feed on public.forum_topics(pinned desc,created_at desc,id desc) where deleted_at is not null;
commit;
