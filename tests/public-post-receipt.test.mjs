import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['lib/public-post-receipt.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {readPublicPostReceipt,writePublicPostReceipt,clearPublicPostReceipt}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const id='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
function storage(){const values=new Map();return{values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};}

test('receipt restores exact JSON request and remains isolated by author/source scope',()=>{
 const store=storage(),input={requestId:id,caption:'Draft',media:[{objectPath:'user/beauty/image/a.webp',role:'image'}],postType:'regular'};
 writePublicPostReceipt('beauty:user:profile',{requestId:id,input},store);
 assert.deepEqual(readPublicPostReceipt('beauty:user:profile',store),{requestId:id,input});
 assert.equal(readPublicPostReceipt('beauty:other:profile',store),null);
 assert.equal(readPublicPostReceipt('salon:user:profile',store),null);
 clearPublicPostReceipt('beauty:user:profile',other,store);assert.equal(store.values.size,1);
 clearPublicPostReceipt('beauty:user:profile',id,store);assert.equal(store.values.size,0);
});
test('an unresolved key cannot be overwritten by a fresh ID or a changed payload',()=>{
 const store=storage(),scope='beauty:user:profile',receipt={requestId:id,input:{requestId:id,caption:'original'}};
 writePublicPostReceipt(scope,receipt,store);writePublicPostReceipt(scope,receipt,store);
 assert.throws(()=>writePublicPostReceipt(scope,{requestId:other,input:{requestId:other,caption:'other'}},store),/could not be read safely/);
 assert.throws(()=>writePublicPostReceipt(scope,{requestId:id,input:{requestId:id,caption:'changed'}},store),/could not be read safely/);
 assert.deepEqual(readPublicPostReceipt(scope,store),receipt);
});
test('corrupt receipts, credentials, files and unavailable persistence fail closed',()=>{
 const store=storage(),scope='beauty:user:profile';
 store.setItem('reylumi:public-post:v1:'+scope,'corrupt');
 assert.throws(()=>readPublicPostReceipt(scope,store),/could not be read safely/);assert.equal(store.values.size,1);
 for(const extra of [{accessToken:'never-store'},{file:new File(['fixture'],'photo.png')},{nested:{previewUrl:'blob:private'}}]){
  assert.throws(()=>writePublicPostReceipt('beauty:user:new',{requestId:id,input:{requestId:id,...extra}},store),/could not be read safely/);
 }
 assert.throws(()=>writePublicPostReceipt(scope,{requestId:id,input:{requestId:id}},{getItem:()=>null,setItem:()=>{throw Error('quota');},removeItem:()=>{}}),/unavailable/);
 assert.equal(store.values.size,1);
});
