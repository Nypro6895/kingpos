# Forum starter content

Compact forum UI published to dpl_HH57U1pRRCGKBEi8eGRdy5JtcEuA. Logo teal is #1d807c, sampled from the original PNG. Hosted route only; no new native binary needed.

## Content pending

Migration `20261103190000_forum_starter_discussions.sql` is committed but NOT applied. 15 discussions (10 Vietnamese, 5 English), 30 replies, 8 personas with local SVGs. Personas never create auth/users records and have no online status or fabricated popularity. Mod delete/restore still works. Direct reads remain revoked with RLS.

Apply via the existing Supabase SQL workflow, transactionally record the exact body in schema_migrations, then verify 15/30/8 counts, 3 topics per section, RLS and denied anonymous/direct access. Production apply/verify scripts and local passing checks are in artifacts/forum-brand. The same transaction passed the real PostgreSQL local fixture. No seed data has been posted to production. Chrome controller errors persisted after reset and owner reconnect.

Pending journal event: 1d2321e5-c327-449a-9f81-73fa9689a8c0. Source commit: 73ba22eec77ebd1f2b63b720274be6e132eea912.
