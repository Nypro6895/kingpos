import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import {ShopMoneyWorkspace} from '@/app/payroll/shop-money-workspace';
const args=(window as unknown as {fixture:{salonId:string;start:string;end:string}}).fixture;
function App(){const [view,setView]=useState<'shop'|'expenses'|'gifts'|'rewards'|'discounts'>('shop');return <><nav>{(['shop','expenses','gifts','rewards','discounts'] as const).map(v=><button key={v} onClick={()=>setView(v)}>{v}</button>)}</nav><ShopMoneyWorkspace {...args} view={view} payout={{cash:300,check:400,tax:100}}/></>;}
createRoot(document.getElementById('root')!).render(<App/>);
