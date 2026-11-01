import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import {ShopMoneyWorkspace} from '@/app/payroll/shop-money-workspace';
import {ReportTabs} from '@/app/reports/report-controls';
const args=(window as unknown as {fixture:{salonId:string;start:string;end:string}}).fixture;
function App(){const [view,setView]=useState<'shop'|'expenses'|'gifts'|'rewards'|'discounts'|'reports'>('shop');return <><nav>{(['shop','expenses','gifts','rewards','discounts','reports'] as const).map(v=><button key={v} onClick={()=>setView(v)}>{v}</button>)}</nav>{view==='reports'?<ReportTabs expenses={<ShopMoneyWorkspace {...args} view="expenses"/>} overview={<p>Reports overview</p>}><p>Daily closing</p></ReportTabs>:<ShopMoneyWorkspace {...args} view={view} payout={{cash:300,check:400,tax:100}}/>}</>;}
createRoot(document.getElementById('root')!).render(<App/>);
