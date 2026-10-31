"use client";
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { WorkspaceText, useWorkspaceTranslation } from '@/components/workspace-language';
import {serviceCategoryColor} from '@/lib/pos-service-catalog';
import {dialogOutsideClick, dialogOutsidePointerDown} from '@/lib/dialog-outside-dismiss';
import type {PosWorkspacePreferences} from '@/lib/pos-workspace-preferences';
import './adaptive-pos-workspace.css';

type CatalogService={id:string;name:string;category?:string|null;base_price?:number|string|null;requested?:boolean;booking_parent_service_id?:string|null};
export function ServiceCatalog({services,preferences,selectedId,disabled,onSelect}:{services:CatalogService[];preferences:Pick<PosWorkspacePreferences,'serviceCategoriesEnabled'|'serviceCategoryColors'>;selectedId?:string|null;disabled?:boolean;onSelect:(id:string)=>void}){
 const t=useWorkspaceTranslation();const [open,setOpen]=useState(false);const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{if(open)dialog.current?.showModal();},[open]);
 const groups=new Map<string,CatalogService[]>();for(const service of services){const category=service.category?.trim()||'';const items=groups.get(category)??[];items.push(service);groups.set(category,items);}
 const ordered=preferences.serviceCategoriesEnabled?[...[...groups].filter(([category])=>category).flatMap(([,items])=>items),...(groups.get('')??[])]:services;
 const main=ordered.filter(service=>!service.booking_parent_service_id),addons=ordered.filter(service=>Boolean(service.booking_parent_service_id));
 function tile(service:CatalogService,close=false){const category=service.category?.trim()||'';const color=preferences.serviceCategoriesEnabled&&category?serviceCategoryColor(category,preferences.serviceCategoryColors):null;
 return <button key={service.id} type="button" disabled={disabled} aria-pressed={selectedId===service.id} data-pos-service-tile data-pos-service-category={category||undefined} data-pos-requested-service={service.requested||undefined} title={category?service.name+' · '+category:service.name} onClick={()=>{onSelect(service.id);if(close)dialog.current?.close();}} style={color?{backgroundColor:color+'30',borderTop:'3px solid '+color}:undefined}><span>{service.name}</span>{service.base_price!=null?<small className="tabular-nums">{new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(service.base_price)||0)}</small>:null}</button>;
 }
 return <div data-pos-service-catalog><div data-pos-service-tiles>{main.map(service=>tile(service))}
  {addons.length>0&&<button type="button" disabled={disabled} data-pos-service-folder aria-haspopup="dialog" aria-label={t(`Add-ons (${addons.length})`)} onClick={()=>setOpen(true)}><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" /></svg><span><WorkspaceText text="Add-ons" /></span><small>{addons.length}</small></button>}
 </div>
 {open&&createPortal(<dialog ref={dialog} className="pos-addon-dialog" aria-label={t("Add-on services")} onClose={()=>setOpen(false)} onPointerDown={dialogOutsidePointerDown} onClick={dialogOutsideClick}><header><h2><WorkspaceText text="Add-on services" /></h2><button type="button" aria-label={t("Close add-ons")} onClick={()=>dialog.current?.close()}>×</button></header><div className="pos-addon-grid">{addons.map(service=>tile(service,true))}</div></dialog>,document.body)}
 </div>;
}
