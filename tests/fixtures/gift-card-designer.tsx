import React,{Activity,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ManageGiftCards} from '../../components/gift-card/manage-gift-cards';
import {defaultGiftDesign} from '../../types/gift-card';
let design=defaultGiftDesign('King Nails Spa LLC');
const transport=async(op:string,args?:Record<string,unknown>)=>{if(op==='design'){if((window as any).failSave)throw Error('Synthetic save failed');design=args!.design as typeof design;(window as any).saved=design;}return {design,installed:true,stats:{issued:125000,redeemed:34000,outstanding:91000,soldCount:25,usedCount:7},cards:[],ledger:[]};};
function Fixture(){const [hidden,setHidden]=useState(false);(window as any).hideGift=setHidden;return <Activity mode={hidden?'hidden':'visible'}><ManageGiftCards salonName="King Nails Spa LLC" transport={transport}/></Activity>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);
