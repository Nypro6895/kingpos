import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { RewardDiscovery } from "../../components/rewardlumi/reward-discovery";
function App(){
 const [gps,setGps]=useState(false);
 return <main><div className="grid"><section data-fresh><h1>Fresh looks</h1><p>Organic discovery content</p><button onClick={()=>setGps(true)} id="choose-gps">Use GPS fixture</button></section><RewardDiscovery location="Chicago, IL" category="Nails" {...(gps?{latitude:41.88,longitude:-87.63}:{})}/><section data-tail>More organic content</section></div></main>;
}
createRoot(document.getElementById("root")!).render(<App/>);
