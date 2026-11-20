import React from 'react';
import {createRoot} from 'react-dom/client';
import {RewardWallet} from '../../components/rewardlumi/reward-workspaces';
import {BookingRewardPending} from '../../components/rewardlumi/booking-reward-pending';
import {CustomerJourney} from '../../app/activity/customer-journey';
const bookingId='00000000-0000-4000-8000-000000000001';
const item={type:'booking' as const,id:'booking-'+bookingId,bookingId,href:'/my-bookings/'+bookingId,currency:'USD',startAt:'2030-11-06T15:00:00Z',endAt:'2030-11-06T16:00:00Z',occurredAt:'2030-11-06T15:00:00Z',timezone:'America/Chicago',status:'upcoming' as const,bookingStatus:'confirmed' as const,salon:{id:'salon',name:'Lumi Nail Studio',imageUrl:null,coverUrl:null},services:[{id:'service',name:'Manicure',staffName:'Mia'}],staffName:'Mia',title:'Appointment',total:60};
const route=location.pathname;
createRoot(document.getElementById('root')!).render(route==='/wallet'?<RewardWallet/>:route==='/appointments'?<CustomerJourney activity={{upcoming:[item],history:[],salonCount:1,totalCount:1}}/>:<main style={{padding:16,maxWidth:440,margin:'auto'}}><h1>Booking confirmed</h1><p>Lumi Nail Studio · Manicure</p><BookingRewardPending bookingId={bookingId}/></main>);
