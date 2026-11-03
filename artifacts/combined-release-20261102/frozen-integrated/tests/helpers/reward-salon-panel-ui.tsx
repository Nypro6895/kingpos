import React from "react";
import { createRoot } from "react-dom/client";
import { RewardSalonPanel } from "../../components/rewardlumi/reward-salon-panel";
const first="00000000-0000-4000-8000-000000000001",second="00000000-0000-4000-8000-000000000002";
function App(){const[id,setId]=React.useState(first);return <main><RewardSalonPanel salonId={id} canBook={!new URLSearchParams(location.search).has("no-book")}/><button type="button" onClick={()=>setId(second)}>Switch salon</button><p>Salon profile remains available.</p></main>;}
createRoot(document.getElementById("root")!).render(<App/>);
