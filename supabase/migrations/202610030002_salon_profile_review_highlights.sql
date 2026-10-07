alter table public.salon_profile_preferences
 add column if not exists show_customer_reviews boolean not null default true,
 add column if not exists customer_review_count smallint not null default 3 check (customer_review_count in (2,3));
