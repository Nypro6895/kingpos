async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){const {redirect}=await import('next/navigation');const p=await searchParams;const q=new URLSearchParams({tab:'credits'});for(const [k,v] of Object.entries(p))if(typeof v==='string'&&k!=='tab')q.set(k,v);redirect('/admin/plugins/campaigns?'+q);}
export default Page;
