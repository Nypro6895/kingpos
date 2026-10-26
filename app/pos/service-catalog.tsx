"use client";
import {serviceCategoryColor} from '@/lib/pos-service-catalog';
import type {PosWorkspacePreferences} from '@/lib/pos-workspace-preferences';
import './adaptive-pos-workspace.css';
type CatalogService={id:string;name:string;category?:string|null;base_price?:number|string|null;requested?:boolean};
export function ServiceCatalog({services,preferences,selectedId,disabled,onSelect}:{services:CatalogService[];preferences:Pick<PosWorkspacePreferences,'serviceCategoriesEnabled'|'serviceCategoryColors'>;selectedId?:string|null;disabled?:boolean;onSelect:(id:string)=>void}){
 const groups=new Map<string,CatalogService[]>();for(const service of services){const category=service.category?.trim()||'';const items=groups.get(category)??[];items.push(service);groups.set(category,items);}
 const ordered=preferences.serviceCategoriesEnabled?[...[...groups].filter(([category])=>category).flatMap(([,items])=>items),...(groups.get('')??[])]:services;
 return <div data-pos-service-catalog><div data-pos-service-tiles>{ordered.map(service=>{const category=service.category?.trim()||'';const color=preferences.serviceCategoriesEnabled&&category?serviceCategoryColor(category,preferences.serviceCategoryColors):null;
 return <button key={service.id} type="button" disabled={disabled} aria-pressed={selectedId===service.id} data-pos-service-tile data-pos-service-category={category||undefined} data-pos-requested-service={service.requested||undefined} title={category?service.name+' · '+category:service.name} onClick={()=>onSelect(service.id)} style={color?{backgroundColor:color+'30',borderTop:'3px solid '+color}:undefined}><span>{service.name}</span>{service.base_price!=null?<small className="tabular-nums">{new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(service.base_price)||0)}</small>:null}</button>;
 })}</div></div>;
}
