/** Salon-local midnight bounds, including daylight-saving changes. */
export function ticketDayBounds(date:string,timeZone:string){
 const [year,month,day]=date.split("-").map(Number);
 const offset=(instant:number)=>{
  const parts=new Intl.DateTimeFormat("en-US",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(new Date(instant));
  const part=(key:string)=>Number(parts.find(row=>row.type===key)?.value??0);
  return Date.UTC(part("year"),part("month")-1,part("day"),part("hour"),part("minute"),part("second"))-instant;
 };
 const midnight=(dayOffset:number)=>{const local=Date.UTC(year,month-1,day+dayOffset);return local-offset(local-offset(local));};
 return {openedFrom:new Date(midnight(0)).toISOString(),openedTo:new Date(midnight(1)-1).toISOString()};
}
