export function planPosTiles(width:number,height:number,staffCount:number,serviceCount:number) {
  const gap=6;
  const layout=(density:number)=>{
    const staffWidth=Math.round(68+36*density),staffHeight=Math.round(80+24*density),serviceWidth=Math.round(82+42*density),serviceHeight=Math.round(56+16*density);
    const columns=(size:number)=>Math.max(1,Math.floor((Math.max(0,width-14)+gap)/(size+gap)));
    const staffColumns=columns(staffWidth),serviceColumns=columns(serviceWidth);
    const required=(count:number,cols:number,size:number)=>count?Math.ceil(count/cols)*(size+gap)-gap+4:0;
    return {density,staffWidth,staffHeight,serviceWidth,serviceHeight,staffColumns,serviceColumns,staffRequired:required(staffCount,staffColumns,staffHeight),serviceRequired:required(serviceCount,serviceColumns,serviceHeight)};
  };
  let result=layout(0);
  for(let step=20;step>=0;step--){const candidate=layout(step/20);if(candidate.staffRequired+candidate.serviceRequired<=height){result=candidate;break;}}
  const overflow=result.staffRequired+result.serviceRequired>height;
  let staffSpace=result.staffRequired;
  if(overflow&&staffCount&&serviceCount)staffSpace=Math.max(result.staffHeight,Math.min(height-result.serviceHeight,height*result.staffRequired/(result.staffRequired+result.serviceRequired)));
  else if(overflow&&staffCount)staffSpace=height;
  return {...result,overflow,staffSpace:Math.max(0,staffSpace),serviceSpace:Math.max(0,height-staffSpace)};
}
