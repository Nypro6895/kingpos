import type{ComponentProps}from"react";
import type{CampaignWorkspace}from"@/app/campaigns/campaign-workspace";
import type{BookingDepositState}from"@/types/booking-deposit";
import type{MarketBankOrder}from"@/types/market-bank-billing";
export const APP_LOCAL_COMMERCE_ROUTES=["/campaigns","/market/booking-deposit/settings","/market/orders/:orderId","/explore/campaigns/:campaignId"];
export const APP_LOCAL_COMMERCE_READS={
 "owner.campaigns":{argumentKeys:[],retention:"scoped"},
 "owner.deposit-settings":{argumentKeys:[],retention:"scoped"},
 "owner.market-order":{argumentKeys:["orderId"],retention:"none"},
 "public.campaign":{argumentKeys:["campaignId"],retention:"none"},
}as const;
export type AppLocalCampaigns=ComponentProps<typeof CampaignWorkspace>;
export type AppLocalDepositSettings={salonId:string;state:BookingDepositState;paid:boolean};
export type AppLocalMarketOrder={order:MarketBankOrder;business:{id:string;name:string}|null};
export type AppLocalPublicCampaign={salonId:string;endsAt:string;title:string;caption:string;imageUrl:string|null};
