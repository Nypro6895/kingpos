const uuid="[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const device=new RegExp(`^${uuid}:${uuid}$`,"i");
/** Shape only. Every resource/command still validates its current authority. */
export function isAppLocalScopeId(value:unknown):value is string{return typeof value==="string"&&(/^v3:[a-f0-9]{64}$/.test(value)||device.test(value));}
export function isAppLocalPortableScopeId(value:unknown):value is string{return typeof value==="string"&&device.test(value);}
