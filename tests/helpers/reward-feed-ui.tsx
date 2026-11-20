import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { RewardDiscovery } from "../../components/rewardlumi/reward-discovery";

type Props = { latitude?: number|null; longitude?: number|null; location?: string; category?: string; viewerId?: string|null; adjacentSalonIds?: string[] };
declare global {
 interface Window {
  __rewardFixture: { props: Props; scope: string; adjacent: boolean };
  rewardHarness: {
   scope: string; states: Record<string, {hidden?:boolean}>;
   configure(values: Partial<Props> & {scope?:string}): void;
   social(states: Record<string,{hidden?:boolean}>): void;
   bookings: {href:string;rewardDialogs:number}[];
   navigation: string[];
  };
 }
}

function Fixture() {
 const [props, setProps] = useState(window.__rewardFixture.props);
 window.rewardHarness.configure = values => {
  const {scope,...next} = values;
  if (scope !== undefined) { window.rewardHarness.scope = scope; window.dispatchEvent(new Event("fixture:scope")); }
  setProps(previous=>({...previous,...next}));
 };
 return <main className="fixtureMain" data-feed-fixture-ready>
  <h1>Explore</h1><div className="fixtureSearch">Salons, services or ideas <span>{props.location || "Choose area"}</span></div>
  {window.__rewardFixture.adjacent && <article className="fixtureOrganic" data-adjacent-post><img src="/salon-cover.webp" alt="Existing business post fixture"/><strong>King Nails Spa · Fresh looks</strong><p>Your next appointment inspiration.</p></article>}
  <RewardDiscovery {...props}/>
  <article className="fixtureOrganic" data-organic-post><h2>Fresh looks</h2><p>Organic Explore feed remains available.</p><button type="button" onClick={()=>document.querySelector("[data-organic-status]")!.textContent="Organic post opened"}>Open organic post</button><p data-organic-status/></article>
 </main>;
}

window.rewardHarness = {
 scope:window.__rewardFixture.scope,states:{},configure:()=>{},
 social(states){this.states=states;window.dispatchEvent(new Event("fixture:social"));},bookings:[],navigation:[],
};
window.addEventListener("reylumi:quick-book", event=>{
 const href=(event as CustomEvent<{href:string}>).detail.href;
 window.rewardHarness.bookings.push({href,rewardDialogs:document.querySelectorAll("[data-reward-discovery] dialog[open]").length});
 const booking=document.createElement("dialog");booking.dataset.bookingFixture="";booking.innerHTML="<p>Booking event fixture</p><button>Close booking</button>";booking.querySelector("button")!.addEventListener("click",()=>booking.remove());document.body.append(booking);booking.showModal();
});
document.addEventListener("click",event=>{
 const anchor=(event.target as Element).closest?.("a[href]") as HTMLAnchorElement|null;
 if(anchor){event.preventDefault();window.rewardHarness.navigation.push(anchor.getAttribute("href")!);}
});
createRoot(document.getElementById("root")!).render(<Fixture/>);
