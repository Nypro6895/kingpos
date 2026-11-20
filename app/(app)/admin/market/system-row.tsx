'use client';
import {useEffect,useRef,type ReactNode} from 'react';
export function SystemRow({id,name,value,scope,open=false,children}:{id:string;name:string;value:string;scope:string;open?:boolean;children:ReactNode}){
 const ref=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{const reveal=()=>{if(location.hash===`#${id}`&&ref.current){ref.current.open=true;ref.current.scrollIntoView({block:'start'});}};reveal();window.addEventListener('hashchange',reveal);return()=>window.removeEventListener('hashchange',reveal);},[id]);
 return <details ref={ref} id={id} className="system-row" open={open}><summary><span className="system-row-name">{name}</span><span className="system-row-value">{value}</span><span className="system-row-scope">{scope}</span></summary><div className="system-row-body">{children}</div></details>;
}
