delete from public.salon_profile_looks looks
where looks.title = 'Codex QA Bookable Inspiration'
  and looks.booking_note = 'codex-booking-inspiration-browser-qa';

select
  (
    select count(*)
    from public.salon_profile_looks looks
    where looks.title = 'Codex QA Bookable Inspiration'
      and looks.booking_note = 'codex-booking-inspiration-browser-qa'
  ) as remaining_browser_look_fixtures;
