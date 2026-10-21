import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

test('selection matches admission global daily cap without changing snapshot policy or counting other days/events/viewers', async () => {
  const db = new PGlite();
  const viewer = 'a'.repeat(64), id = '00000000-0000-0000-0000-000000000001';
  const area = {country:'US',state:'WI',city:'Milwaukee',zipcode:'',neighborhood:''};
  try {
    await db.exec(`create table owner_campaigns(id uuid primary key,salon_id uuid,owner_id uuid,source_type text,source_id uuid,status text,starts_at timestamptz,ends_at timestamptz,payment_reference text,approved_at timestamptz,views int,credit_view_limit int,spent_cents int,total_price_cents int,country text,area text,location text,state text,city text,daily_views int,settings_snapshot jsonb,created_at timestamptz,days int);
      create table owner_campaign_events(campaign_id uuid,visitor_hash text,day date,kind text,created_at timestamptz,nonce uuid);
      create table owner_campaign_settings(id boolean,config jsonb);
      insert into owner_campaign_settings values(true,'{"enabled":true,"maxAdsPerDay":999}');
      create function owner_campaign_post(text,uuid,uuid) returns jsonb language sql as $$select '{}'::jsonb$$;
      create function lifecycle_user_is_salon_owner(uuid,uuid,boolean) returns boolean language sql as $$select true$$;
      insert into owner_campaigns values('${id}','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','custom','30000000-0000-0000-0000-000000000001','running',now()-interval '1 day',now()+interval '1 day','paid',now(),0,1000,0,100,'US','city','Milwaukee','WI','Milwaukee',500,'{"dailyFrequency":2,"maxAdsPerDay":6}',now()-interval '2 days',2);`);
    // Load the real admission core, applying the same later migration substitutions.
    const original = fs.readFileSync('supabase/migrations/202610080002_owner_campaigns.sql','utf8');
    const start = original.indexOf('create function public.owner_campaign_admit(');
    const admission = original.slice(start, original.indexOf('end $$;',start)+7)
      .replaceAll('c.days*c.daily_views','c.credit_view_limit')
      .replace('select config into cfg from public.owner_campaign_settings where id;',
        "cfg:=c.settings_snapshot || jsonb_build_object('enabled',(select (config->>'enabled')::boolean from public.owner_campaign_settings where id));");
    await db.exec(admission);
    await db.exec(fs.readFileSync('supabase/migrations/20261019170000_campaign_local_rotation.sql','utf8'));
    const select = async () => (await db.query('select id from owner_campaign_candidates($1,$2)',[area,viewer])).rows;
    await db.query(`insert into owner_campaign_events select '99999999-0000-0000-0000-000000000001',$1,(now() at time zone 'America/Chicago')::date,'view',now(),null from generate_series(1,6)`,[viewer]);
    assert.equal((await select()).length,1,'baseline reproduces selecting an ad at the existing global cap');
    const admitted = await db.query('select owner_campaign_admit($1,$2,$3,$4) as ok',[id,viewer,'view',area]);
    assert.equal(admitted.rows[0].ok,false,'actual admission core rejects the same selected ad');
    assert.equal(Number((await db.query('select count(*) as n from owner_campaign_events')).rows[0].n),6,'no view/billing write at cap');
    await db.exec(fs.readFileSync('supabase/migrations/20261021010000_campaign_selection_daily_cap.sql','utf8'));
    assert.equal((await select()).length,0,'fixed selector respects the same snapshot cap');
    await db.exec(`update owner_campaigns set settings_snapshot='{"dailyFrequency":2,"maxAdsPerDay":7}'`);
    assert.equal((await select()).length,1,'do not replace campaign-specific cap with default 6 or global settings');
    await db.exec(`update owner_campaigns set settings_snapshot='{"dailyFrequency":2}'`);
    assert.equal((await select()).length,0,'same fallback 6 as admission');
    await db.exec(`update owner_campaign_events set day=(now() at time zone 'America/Chicago')::date-1`);
    assert.equal((await select()).length,1,'Chicago day reset');
    await db.exec(`update owner_campaign_events set day=(now() at time zone 'America/Chicago')::date,kind='click'`);
    assert.equal((await select()).length,1,'clicks do not consume view cap');
    await db.exec(`update owner_campaign_events set kind='view',visitor_hash='other'`);
    assert.equal((await select()).length,1,'other visitors do not consume this viewer cap');
    assert.equal((await db.query('select id from owner_campaign_candidates($1,$2,$3)',[area,viewer,'20000000-0000-0000-0000-000000000001'])).rows.length,0,'owner remains excluded');
  } finally { await db.close(); }
});
