import React from "react";
import { createRoot } from "react-dom/client";
import { RewardOwnerPrompt } from "../../components/rewardlumi/reward-owner-prompt";
const setup = new URLSearchParams(location.search).get("setup") === "1";
createRoot(document.getElementById("root")!).render(<main style={{maxWidth:620,margin:"auto",padding:12,fontFamily:"Arial,sans-serif"}}><RewardOwnerPrompt setup={setup}/><p>Today workspace remains available.</p></main>);
