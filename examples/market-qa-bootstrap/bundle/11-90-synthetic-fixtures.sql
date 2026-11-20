-- Deterministic synthetic data only. No Auth accounts, passwords, secret hashes,
-- client credentials, sandbox tokens, grants or provider accounts are created.
INSERT INTO public.users(id,auth_user_id,email,display_name,status) VALUES
('10000000-0000-4000-8000-000000000001',NULL,'owner@qa.example.invalid','Synthetic salon Owner','active'),
('10000000-0000-4000-8000-000000000002',NULL,'developer@qa.example.invalid','Synthetic developer','active'),
('10000000-0000-4000-8000-000000000003',NULL,'reviewer@qa.example.invalid','Synthetic reviewer','active'),
('10000000-0000-4000-8000-000000000004',NULL,'other@qa.example.invalid','Synthetic other salon Owner','active');
INSERT INTO public.accounts VALUES('20000000-0000-4000-8000-000000000001','Synthetic QA salon account A','active'),('20000000-0000-4000-8000-000000000002','Synthetic QA salon account B','active');
INSERT INTO public.roles VALUES('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','OWNER'),('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','OWNER');
INSERT INTO public.account_memberships VALUES('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','active'),('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000002','active');
INSERT INTO public.locations VALUES('40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Synthetic QA salon A','active'),('40000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','Synthetic QA salon B','active');
INSERT INTO market_private.reviewers(user_id) VALUES('10000000-0000-4000-8000-000000000003');
-- Feature and test commerce remain OFF. Auth binding/publication/consent/review
-- occur only through a separately reviewed QA setup; no auto-activation.
