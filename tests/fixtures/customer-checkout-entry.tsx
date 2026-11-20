import React from 'react';
import {createRoot} from 'react-dom/client';
import {CustomerDisplayClient} from '../../app/pos/customer-display/customer-display-client';
import {publishLocalDisplaySnapshot} from '../../lib/pos-local-display';
const initial=await fetch('/fixture/draft').then(r=>r.json());
const settings={appDownloadUrl:'https://reylumi.com',customerBackgroundImageUrl:null,customerLeftAdImageUrl:null,customerRightAdImageUrl:null,customerLeftAdText:'Stay connected',customerRightAdText:'Rewards and booking',customerPromoTitle:'Welcome',customerPromoBody:'Welcome',customerShowBarcode:true,customerShowCustomerName:true,customerShowReceiptStatus:true,customerShowSalonName:true,customerShowServiceName:true,customerShowStaffName:true,salonLogoUrl:null,salonName:'King Nails Spa LLC',tipSuggestions:[5,10,15,20]};
Object.assign(window,{applyCheckoutSnapshot:publishLocalDisplaySnapshot});
// Synthetic POS broadcast boundary; the display receives the real product event.
let revision=initial.version;
setInterval(async()=>{const next=await fetch('/fixture/draft').then(r=>r.json());if(next.version!==revision){revision=next.version;publishLocalDisplaySnapshot(next);}},200);
createRoot(document.getElementById('root')!).render(<CustomerDisplayClient token={initial.token} initialSnapshot={initial} settings={settings} serviceCatalog={[]}/>);
