async function rpc(name: string, args: unknown[]) { const r=await fetch('/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args})}); return r.json(); }
export const membershipWorkspaceAction=(query:string,status:string,page:number,plan='')=>rpc('reylumi_membership_workspace',[query,status,page,plan]);
export const membershipDetailAction=(id:string)=>rpc('reylumi_membership_detail',[id]);
export const membershipSalonSearchAction=(query:string)=>rpc('reylumi_membership_salons',[query]);
export const membershipCommandAction=(input:unknown)=>rpc('reylumi_membership_command',[JSON.stringify(input)]);
export const membershipActivityAction=(kind:string,query:string,status:string,page:number)=>rpc('reylumi_membership_activity',[kind,query,status,page]);
