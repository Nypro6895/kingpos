import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
type Pair={access:string;refresh:string};
type Envelope={iv:string;tag:string;data:string};
const key=(value:string)=>Buffer.from(value.slice(4),"base64url");
const aad=(client:string,request:string)=>Buffer.from("market-refresh-v1:"+client+":"+request);
export function sealRefreshPair(pair:Pair,retryKey:string,client:string,request:string):Envelope {
  const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key(retryKey),iv);
  cipher.setAAD(aad(client,request));
  const bytes=Buffer.concat([cipher.update(JSON.stringify(pair)),cipher.final()]);
  return {iv:iv.toString("base64url"),tag:cipher.getAuthTag().toString("base64url"),data:bytes.toString("base64url")};
}
export function openRefreshPair(envelope:Envelope,retryKey:string,client:string,request:string):Pair {
  if(!envelope || !/^[A-Za-z0-9_-]{16}$/.test(envelope.iv)||!/^[A-Za-z0-9_-]{22}$/.test(envelope.tag)||!/^[A-Za-z0-9_-]{32,2048}$/.test(envelope.data))throw Error("Invalid refresh receipt");
  const decipher=createDecipheriv("aes-256-gcm",key(retryKey),Buffer.from(envelope.iv,"base64url"));
  decipher.setAAD(aad(client,request));decipher.setAuthTag(Buffer.from(envelope.tag,"base64url"));
  const pair=JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data,"base64url")),decipher.final()]).toString());
  if(!/^rmp_[A-Za-z0-9_-]{43}$/.test(pair?.access)||!/^rmr_[A-Za-z0-9_-]{43}$/.test(pair?.refresh))throw Error("Invalid refresh pair");
  return pair;
}
