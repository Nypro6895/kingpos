export function parseUserSelection(value:string) {
  const parsed:unknown=JSON.parse(value);
  if(!Array.isArray(parsed)||parsed.length===0||parsed.length>100||parsed.some(id=>typeof id!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) throw new Error("Select between 1 and 100 valid users.");
  return [...new Set(parsed)] as string[];
}
export function validateEvidenceFile(file:{size:number;type:string},bytes:Uint8Array) {
  if(file.size>8*1024*1024) throw new Error("Evidence files must be 8 MB or smaller.");
  const starts=(signature:number[])=>signature.every((byte,i)=>bytes[i]===byte);
  if(file.type==="application/pdf"&&starts([37,80,68,70,45])) return "pdf";
  if(file.type==="image/png"&&starts([137,80,78,71,13,10,26,10])) return "png";
  if(file.type==="image/jpeg"&&starts([255,216,255])) return "jpg";
  throw new Error("Attach a valid PDF, PNG or JPEG file.");
}
