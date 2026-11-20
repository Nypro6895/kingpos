import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
const file='supabase/migrations/20261011010001_market_automatic_tax.sql',sql=await fs.readFile(file,'utf8');
if(!/^begin;/i.test(sql.trim())||!sql.trim().endsWith('commit;')||sql.includes('$market_tax_source$'))throw Error('Review the migration transaction wrapper.');
const body=sql.replace(/^\s*begin;\s*/i,'').replace(/\s*commit;\s*$/i,'');
const query=`begin;
do $$ begin
 if not exists(select 1 from supabase_migrations.schema_migrations where version='20261010210001') then raise exception 'The card billing baseline migration is missing'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20261011010001') then raise exception 'Tax migration already applied; verify its receipt instead of rerunning'; end if;
end $$;
${body}
insert into supabase_migrations.schema_migrations(version,name,statements) values('20261011010001','market_automatic_tax',array[$market_tax_source$${sql}$market_tax_source$]);
commit;
`;
await fs.writeFile('artifacts/apply-market-automatic-tax.sql',query);
console.log(JSON.stringify({migration:file,sha256:createHash('sha256').update(sql).digest('hex'),transaction:'schema and migration record are atomic'}));
