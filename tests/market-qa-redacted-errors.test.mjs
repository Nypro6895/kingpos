import test from 'node:test';
import assert from 'node:assert/strict';
import {createRedactedErrorLog} from '../artifacts/market-published-qa/redacted-errors.mjs';
// Lexical fixtures only: none is signed, registered, sent to an API or a grant.
test('split credentials are redacted across chunks while original stack frames survive',()=>{
 const secret='unregistered-secret-value',token='rmc_'+'x'.repeat(43),jwt='eyJ'+'synthetic.payload.signature';let out='';
 const log=createRedactedErrorLog({emit:x=>out+=x,secrets:()=>[secret]});
 const input='TypeError: failed '+secret+' '+token+' '+jwt+'\n    at MarketContent (synthetic/page.tsx:4:2)\n';
 for(let i=0;i<input.length;i+=7)log.push(input.slice(i,i+7));log.flush();
 assert.doesNotMatch(out,new RegExp(secret));assert.equal(out.includes(token),false);assert.equal(out.includes(jwt),false);assert.match(out,/TypeError: failed/);assert.match(out,/at MarketContent/);assert.match(out,/\[REDACTED\]/);
});
test('oversize partial line is dropped through its newline, not leaked as a suffix',()=>{let out='';const log=createRedactedErrorLog({emit:x=>out+=x,maxLineLength:32});log.push('x'.repeat(40));log.push('sensitive-suffix');log.push('\n    at safeFrame\n');log.flush();assert.doesNotMatch(out,/sensitive-suffix/);assert.match(out,/Oversize/);assert.match(out,/at safeFrame/);});
test('oversize complete line and unterminated final secret are handled safely',()=>{let out='';const token='rmp_'+'y'.repeat(43);const log=createRedactedErrorLog({emit:x=>out+=x,maxLineLength:80});log.push('z'.repeat(100)+'\nError: '+token);log.flush();assert.equal(out.includes(token),false);assert.match(out,/Oversize/);assert.match(out,/CREDENTIAL REDACTED/);});
test('redaction failure omits line and latest dynamic secrets are respected',()=>{let out='',broken=true,secret='first-unregistered-value';const log=createRedactedErrorLog({emit:x=>out+=x,secrets:()=>{if(broken)throw Error('Synthetic failure');return[secret];}});log.push('private-line\n');broken=false;secret='second-unregistered-value';log.push('Error: '+secret+'\n');assert.doesNotMatch(out,/private-line|second-unregistered-value/);assert.match(out,/redaction failed/);assert.match(out,/Error: \[REDACTED\]/);});
