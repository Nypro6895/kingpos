"use client";
import { bookingStatusLabel } from "@/lib/booking-no-show";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { CustomerName } from "@/components/customer-name";
import type { PortableBookAppointment, PortableBookData } from "../actions";
import { bookingDate, bookingMinute, layoutBookingColumn } from "@/lib/portable-booking-layout";
import { bookingCalendarWindow, type BookingOpeningHours } from "@/lib/booking-calendar-window";
import { displayBookingTime, statusLabel } from "./booking-views";
import styles from "./booking.module.css";

export function BookingDayCalendar({appointments,data,date,openingHours,select,focusRequest=0}: {
  focusRequest?: number;
  appointments: PortableBookAppointment[]; data: PortableBookData; date: string; openingHours?: BookingOpeningHours;
  select: (item: PortableBookAppointment) => void;
}) {
  const [now,setNow]=useState<string|null>(null);
  const [zoom,setZoom]=useState(112);
  const [scaleReady,setScaleReady]=useState(false);
  const [hover,setHover]=useState<{item:PortableBookAppointment;x:number;y:number}|null>(null);
  const hovered=hover ? appointments.find(item=>item.id===hover.item.id) : null;
  const scroller=useRef<HTMLDivElement>(null);
  const previousScale=useRef<{start:number;zoom:number}|null>(null);
  const anchored=useRef<string|null>(null);
  const drag=useRef<{y:number;zoom:number}|null>(null);
  useEffect(()=>{const update=()=>setNow(new Date().toISOString());update();const timer=setInterval(update,60000);return()=>clearInterval(timer);},[focusRequest]);
  useEffect(()=>{const timer=setTimeout(()=>{try{const saved=Number(localStorage.getItem("kingpos:booking-scale"));if(saved>=72&&saved<=240)setZoom(saved);}catch{/* Storage is optional. */}setScaleReady(true);},0);return()=>clearTimeout(timer);},[]);
  useEffect(()=>{const clear=()=>setHover(null);window.addEventListener("resize",clear);return()=>window.removeEventListener("resize",clear);},[]);
  const segments=appointments.flatMap(item=>item.lines?.length && item.lines.every(line=>line.startAt&&line.endAt)
    ? item.lines.map(line=>({...item,id:`${item.id}:${line.id}`,staffId:line.staffId,staffName:line.staffName||data.staff.find(member=>member.id===line.staffId)?.display_name||null,startAt:line.startAt!,endAt:line.endAt!,serviceNames:[line.serviceName],booking:item}))
    : [{...item,booking:item}]);
  const keyFor=(item:PortableBookAppointment)=>item.staffId||data.staff.find(member=>member.display_name===item.staffName)?.id||item.staffName||"__unassigned";
  const staffColumns=new Map(data.staff.map(member=>[member.id,member.display_name]));
  for(const item of segments)staffColumns.set(keyFor(item),item.staffName||"Unassigned");
  if(!staffColumns.size)staffColumns.set("__unassigned","Unassigned");
  const allColumns=[...staffColumns].map(([id,name])=>({id,name,rows:layoutBookingColumn(segments.filter(item=>keyFor(item)===id),date,data.timezone)}));
  const columns=allColumns;
  const nowMinute=now&&bookingDate(now,data.timezone)===date?bookingMinute(now,data.timezone):null;
  const scheduleWindow=bookingCalendarWindow(openingHours,date,allColumns.flatMap(column=>column.rows),nowMinute);
  const {start,end}=scheduleWindow;
  const pxPerMinute=zoom/60;
  const height=(end-start)*pxPerMinute;
  const ticks=Array.from({length:Math.ceil((end-start)/60)},(_,index)=>start+index*60);
  const label=(minute:number)=>`${Math.floor(minute/60)%12||12}:${String(minute%60).padStart(2,"0")} ${minute<720?"AM":"PM"}`;
  const closedBands: {start:number;end:number}[]=[];
  if(scheduleWindow.known){let cursor=start;for(const interval of scheduleWindow.intervals){if(interval.start>cursor)closedBands.push({start:cursor,end:interval.start});cursor=Math.max(cursor,interval.end);}if(cursor<end)closedBands.push({start:cursor,end});}
  function scale(value:number){const next=Math.round(Math.max(72,Math.min(240,value)));setZoom(next);setHover(null);try{localStorage.setItem("kingpos:booking-scale",String(next));}catch{/* Storage is optional. */}}
  useLayoutEffect(()=>{
    const previous=previousScale.current;
    if(scroller.current&&previous&&(previous.start!==start||previous.zoom!==zoom)) {
      scroller.current.scrollTop=(scroller.current.scrollTop/(previous.zoom/60)+previous.start-start)*pxPerMinute;
    }
    previousScale.current={start,zoom};
  },[start,zoom,pxPerMinute]);
  useLayoutEffect(()=>{
    const element=scroller.current;
    if(!element||!now||!scaleReady)return;
    const request=`${date}:${focusRequest}`;
    function focusTime(){
      if(!element||!element.clientHeight||anchored.current===request)return;
      const heading=element.querySelector<HTMLElement>("[data-calendar-time-heading]")?.offsetHeight??0;
      element.scrollTop=nowMinute===null?0:Math.max(0,(nowMinute-start)*pxPerMinute-(element.clientHeight-heading)*0.4);
      anchored.current=request;
    }
    const frame=requestAnimationFrame(focusTime);
    const observer=new ResizeObserver(focusTime);
    observer.observe(element);
    return()=>{cancelAnimationFrame(frame);observer.disconnect();};
  },[date,focusRequest,now,nowMinute,scaleReady,start,pxPerMinute]);
  function show(item:PortableBookAppointment,element:HTMLElement){const rect=element.getBoundingClientRect();setHover({item,x:Math.max(8,Math.min(globalThis.innerWidth-328,rect.left+8)),y:Math.max(8,Math.min(globalThis.innerHeight-330,rect.top+Math.min(rect.height,40)))});}
  return <>
    {scheduleWindow.closed && !appointments.length && nowMinute===null ? <p className={styles.emptyCalendar}>The salon is closed on this date.</p> : !columns.length ? <p className={styles.emptyCalendar}>No matching professionals.</p> : <div className={styles.calendarScroll} ref={scroller} aria-label="Day schedule" tabIndex={0} onScroll={()=>setHover(null)}>
      <div className={styles.calendar} style={{minWidth:64+columns.length*160,gridTemplateColumns:`64px repeat(${columns.length}, minmax(160px, 1fr))`,"--booking-hour-height":`${zoom}px`} as CSSProperties}>
        <div className={styles.timeHeading} data-calendar-time-heading><span>Time</span><button type="button" className={styles.scaleHandle} aria-label="Drag to stretch time scale" onPointerDown={e=>{drag.current={y:e.clientY,zoom};e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(drag.current)scale(drag.current.zoom+e.clientY-drag.current.y);}} onPointerUp={e=>{drag.current=null;e.currentTarget.releasePointerCapture(e.pointerId);}} onPointerCancel={()=>{drag.current=null;}} onKeyDown={e=>{if(e.key==="ArrowUp"||e.key==="ArrowDown"){e.preventDefault();scale(zoom+(e.key==="ArrowUp"?8:-8));}}}>↕</button></div>
        {columns.map(column=><div className={styles.staffHeading} key={column.id}>{column.name}</div>)}
        <div className={styles.timeScale} style={{height}}>{ticks.map(minute=><span key={minute} style={{top:(minute-start)*pxPerMinute}}>{label(minute).replace(":00","")}</span>)}</div>
        {columns.map(column=><div className={styles.staffColumn} key={column.id} style={{height}}>
          {closedBands.map((band,index)=><div className={styles.closedHours} key={index} style={{top:(band.start-start)*pxPerMinute,height:(band.end-band.start)*pxPerMinute}} aria-label="Outside opening hours" />)}
          {column.rows.map(({item,start:from,end:to,lane,lanes})=>{const cardHeight=(to-from)*pxPerMinute;const original=segments.find(segment=>segment.id===item.id)?.booking??item;return <button key={item.id} type="button" className={styles.appointment} data-status={item.status} data-compact={cardHeight<44}
            style={{top:(from-start)*pxPerMinute,height:cardHeight,left:`calc(${lane/lanes*100}% + 3px)`,width:`calc(${100/lanes}% - 6px)`}}
            aria-label={`${displayBookingTime(item.startAt,data.timezone)}, ${item.customerName||"Walk-in customer"}, ${item.serviceNames.join(", ")}, ${column.name}, ${(item.status === "no_show" ? bookingStatusLabel(item.status,item.noShowKind) : statusLabel(item.status))}`}
            onPointerEnter={e=>{if(e.pointerType!=="touch")show(original,e.currentTarget);}} onPointerLeave={()=>setHover(null)} onFocus={e=>show(original,e.currentTarget)} onBlur={()=>setHover(null)} onClick={()=>{setHover(null);select(original);}}>
            <strong><CustomerName name={item.customerName} fallback="Walk-in customer" /></strong>
            {cardHeight>=44 && <span>{displayBookingTime(item.startAt,data.timezone)} · {Math.round((to-from))} min</span>}
            {cardHeight>=64 && <span>{item.serviceNames.join(", ")}</span>}
            {cardHeight>=84 && <span>{(item.status === "no_show" ? bookingStatusLabel(item.status,item.noShowKind) : statusLabel(item.status))}</span>}
            {cardHeight>=110 && item.notes && <span>{item.notes}</span>}
          </button>;})}
        </div>)}
        {nowMinute!==null&&<div className={styles.nowLine} data-booking-current-time style={{gridColumn:"1 / -1",gridRow:2,top:(nowMinute-start)*pxPerMinute,left:64}} aria-label={`Current time ${displayBookingTime(now!,data.timezone)}`}><span className={styles.nowLabel}>{displayBookingTime(now!,data.timezone)}</span></div>}
      </div>
    </div>}
    {hover && hovered && createPortal(<div className={styles.calendarPreview} role="tooltip" style={{left:hover.x,top:hover.y}}><strong><CustomerName name={hovered.customerName} fallback="Walk-in customer" /></strong><small>{hovered.customerPhone}</small><p>{displayBookingTime(hovered.startAt,data.timezone)} – {displayBookingTime(hovered.endAt,data.timezone)} · {(hovered.status === "no_show" ? bookingStatusLabel(hovered.status,hovered.noShowKind) : statusLabel(hovered.status))}</p>{hovered.lines?.length ? hovered.lines.map(line=><p key={line.id}>{line.serviceName}<small>{line.staffName||data.staff.find(s=>s.id===line.staffId)?.display_name}</small></p>) : <p>{hovered.serviceNames.join(", ")}<small>{hovered.staffName}</small></p>}{hovered.notes&&<p>{hovered.notes}</p>}<small>Click or tap to view and edit</small></div>,document.body)}
  </>;
}
