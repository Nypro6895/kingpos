-- Synthetic public metadata only; no Auth users/passwords/keys/roles with login.
INSERT INTO public.users(id,email,display_name,status) VALUES
('10000000-0000-4000-8000-000000000001','owner@qa.example.invalid','Synthetic salon Owner','active'),
('10000000-0000-4000-8000-000000000002','developer@qa.example.invalid','Synthetic developer','active'),
('10000000-0000-4000-8000-000000000003','reviewer@qa.example.invalid','Synthetic reviewer','active'),
('10000000-0000-4000-8000-000000000004','other@qa.example.invalid','Synthetic other salon Owner','active');
INSERT INTO public.accounts(id,name,status) VALUES
('20000000-0000-4000-8000-000000000001','Synthetic QA salon account A','active'),
('20000000-0000-4000-8000-000000000002','Synthetic QA salon account B','active');
INSERT INTO public.roles(id,account_id,name,code,is_system) VALUES
('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Owner','OWNER',true),
('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','Owner','OWNER',true);
INSERT INTO public.account_memberships(account_id,user_id,role_id,status) VALUES
('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','active'),
('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000002','active');
INSERT INTO public.locations(id,account_id,name,status) VALUES
('40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Synthetic QA salon A','active'),
('40000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','Synthetic QA salon B','active');
INSERT INTO market_private.reviewers(user_id) VALUES('10000000-0000-4000-8000-000000000003');
-- No role/team/permission changes to real accounts; no settings/install/grant enablement.
