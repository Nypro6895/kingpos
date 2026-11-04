// Read-only integration preflight. Do not regenerate the checkpoint on mismatch.
import fs from 'node:fs';import {createHash} from 'node:crypto';
const checkpoint=JSON.parse(fs.readFileSync(new URL('../docs/market-migration-checkpoint-20261103.json',import.meta.url),'utf8'));
for(const entry of checkpoint.files){
 if(!/^20261103(?:0[1-9]|10)0000_market_[a-z_]+\.sql$/.test(entry.name))throw Error('Invalid frozen migration path');
 const bytes=fs.readFileSync(new URL('../supabase/migrations/'+entry.name,import.meta.url),'utf8').replaceAll('\r\n','\n');
 if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256LF)throw Error('Frozen Market migration differs: '+entry.name+'. Stop integration; use an additive migration, never regenerate this checkpoint to bypass the mismatch.');
}
console.log('Frozen Market migration checkpoint verified: '+checkpoint.files.length+' files (CRLF normalized to LF). No database or deployment action.');
