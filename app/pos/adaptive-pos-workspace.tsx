"use client";
import {useLayoutEffect,useRef,useState,type CSSProperties,type ReactNode} from "react";
import {planPosTiles} from "@/lib/pos-adaptive-layout";
import "./adaptive-pos-workspace.css";
export function AdaptivePosWorkspace({staffCount,serviceCount,className,children}:{staffCount:number;serviceCount:number;className?:string;children:ReactNode}) {
  const ref=useRef<HTMLElement>(null),[size,setSize]=useState({width:700,height:600});
  useLayoutEffect(()=>{
    const element=ref.current;if(!element)return;
    const measure=()=>{const style=getComputedStyle(element),width=element.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),height=Math.max(120,element.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom)-150);if(width>0)setSize(previous=>previous.width===width&&previous.height===height?previous:{width,height});};
    const observer=new ResizeObserver(measure);observer.observe(element);measure();return()=>observer.disconnect();
  },[]);
  const plan=planPosTiles(size.width,size.height,staffCount,serviceCount);
  const style={"--pos-staff-columns":plan.staffColumns,"--pos-service-columns":plan.serviceColumns,"--pos-staff-width":`${plan.staffWidth}px`,"--pos-staff-height":`${plan.staffHeight}px`,"--pos-service-width":`${plan.serviceWidth}px`,"--pos-service-height":`${plan.serviceHeight}px`,"--pos-staff-space":`${plan.staffSpace}px`,"--pos-service-space":`${plan.serviceSpace}px`,"--pos-tile-font":`${11+3*plan.density}px`,"--pos-turn-font":`${22+12*plan.density}px`} as CSSProperties;
  return <section ref={ref} className={className} style={style} data-pos-staff-turn-board data-adaptive-pos data-pos-density={plan.density} data-pos-fit={plan.overflow?"scroll":"all"}>{children}</section>;
}
